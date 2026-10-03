// 本地测试吊床：mock GitHub API + 挂载真实发布台端点 + 静态服务
// 用法：node publisher/test/local-harness.mjs → http://127.0.0.1:8788
// 不接触真实仓库；数据存内存，重启即重置。
import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- 内存存储（模拟仓库） ---- */
const store = new Map();
function blobSha(content) {
	const buf = Buffer.from(content, "utf8");
	return crypto
		.createHash("sha1")
		.update(`blob ${buf.length}\0`)
		.update(buf)
		.digest("hex");
}
function seed(p, content) {
	store.set(p, { content, sha: blobSha(content) });
}
seed(
	"src/content/posts/txt/16文章.md",
	"---\ntitle: Win11 教程\npublished: 2026-10-03\nslug: azuma.zuomu-blog-16\ndraft: false\n---\n\n# 正文\n\n内容A",
);
seed(
	"src/content/posts/txt/17文章.md",
	'---\ntitle: "发布后端测试文章"\npublished: 2026-10-03\n---\n\n正文B\n\n## 小节\n\n```js\nconsole.log(1)\n```\n\n- 列表项',
);
seed(
	"src/content/posts/update/更新公告20260928.md",
	"---\ntitle: 更新公告20260928\npublished: 2026-09-28\n---\n\n1. 更新内容",
);
seed(
	"src/content/dynamic/20261003-0953.md",
	'---\npublished: 2026-10-03 09:53:13\nlocation: "辽宁"\n---\n\n测试动态',
);

/* ---- mock fetch ---- */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
	const u = String(url);
	const method = (init.method || "GET").toUpperCase();
	const respond = (status, obj) => ({
		ok: status < 400,
		status,
		json: async () => obj,
		text: async () => JSON.stringify(obj),
	});

	if (u.includes("raw.githubusercontent.com")) {
		const m = u.match(
			/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/,
		);
		const p = m ? decodeURIComponent(m[1]) : "";
		const e = store.get(p);
		return e
			? { ok: true, status: 200, text: async () => e.content }
			: { ok: false, status: 404, text: async () => "" };
	}

	if (u.includes("api.github.com")) {
		if (/\/git\/trees\//.test(u)) {
			const tree = [...store.keys()].map((p) => ({
				path: p,
				type: "blob",
				sha: store.get(p).sha,
			}));
			return respond(200, { tree, truncated: false });
		}
		const cm = u.match(/\/contents\/(.+?)(\?|$)/);
		if (cm) {
			const p = decodeURIComponent(cm[1]);
			const e = store.get(p);
			if (method === "GET") {
				if (!e) {
					// 目录：返回直接子项数组（GitHub contents API 行为）
					const prefix = p.endsWith("/") ? p : `${p}/`;
					const children = [...store.keys()].filter((k) =>
						k.startsWith(prefix),
					);
					if (children.length) {
						return respond(
							200,
							children.map((k) => ({
								name: k.slice(prefix.length).split("/")[0],
								path: k,
								type: "file",
								sha: store.get(k).sha,
							})),
						);
					}
					return respond(404, { message: "Not Found" });
				}
				return respond(200, {
					sha: e.sha,
					content: Buffer.from(e.content, "utf8").toString("base64"),
				});
			}
			if (method === "PUT") {
				const body = JSON.parse(init.body);
				if (body.sha !== undefined && body.sha !== null) {
					if (!e) return respond(404, { message: "Not Found" });
					if (e.sha !== body.sha)
						return respond(409, { message: "sha does not match" });
				} else if (e) {
					return respond(422, { message: "already exists" });
				}
				const content = Buffer.from(body.content, "base64").toString("utf8");
				const sha = blobSha(content);
				store.set(p, { content, sha });
				return respond(200, { content: { sha } });
			}
			if (method === "DELETE") {
				const body = JSON.parse(init.body);
				if (!e) return respond(404, { message: "Not Found" });
				if (e.sha !== body.sha)
					return respond(409, { message: "sha does not match" });
				store.delete(p);
				return respond(200, { commit: { sha: "mock" } });
			}
		}
		return respond(404, { message: `unmocked ${method} ${u}` });
	}
	return realFetch(url, init);
};

/* ---- 真实端点（mock 生效后动态导入） ---- */
process.env.GITHUB_REPO = process.env.GITHUB_REPO || "mock/blog";
process.env.PUBLISH_TOKEN = process.env.PUBLISH_TOKEN || "test-pass-123";
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || "gh_mock";
const auth = (await import("../api/auth.js")).default;
const articles = (await import("../api/articles.js")).default;
const article = (await import("../api/article.js")).default;
const publish = (await import("../api/publish.js")).default;
const handlers = {
	"/api/auth": auth,
	"/api/articles": articles,
	"/api/article": article,
	"/api/publish": publish,
};

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".md": "text/markdown; charset=utf-8",
};

http
	.createServer(async (req, res) => {
		const url = new URL(req.url, "http://localhost");
		const p = url.pathname;
		if (p.startsWith("/api/")) {
			req.query = Object.fromEntries(url.searchParams);
			const chunks = [];
			for await (const c of req) chunks.push(c);
			const raw = Buffer.concat(chunks).toString("utf8");
			if (raw) {
				try {
					req.body = (req.headers["content-type"] || "").includes("json")
						? JSON.parse(raw)
						: raw;
				} catch {
					req.body = raw;
				}
			}
			const h = handlers[p];
			if (!h) {
				res.statusCode = 404;
				res.end(JSON.stringify({ ok: false, error: "no such endpoint" }));
				return;
			}
			try {
				await h(req, res);
			} catch (e) {
				res.statusCode = 500;
				res.end(JSON.stringify({ ok: false, error: e.message }));
			}
			return;
		}
		const fp = path.join(
			ROOT,
			p === "/" ? "index.html" : decodeURIComponent(p),
		);
		if (!fp.startsWith(ROOT)) {
			res.statusCode = 403;
			res.end();
			return;
		}
		if (existsSync(fp) && statSync(fp).isFile()) {
			res.setHeader(
				"Content-Type",
				MIME[path.extname(fp)] || "application/octet-stream",
			);
			res.end(readFileSync(fp));
		} else {
			res.statusCode = 404;
			res.end("404");
		}
	})
	.listen(8788, "127.0.0.1", () => {
		console.log("harness ready: http://127.0.0.1:8788");
	});
