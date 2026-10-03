/* 发布端点：口令鉴权 → 按配置命名 → 拼 frontmatter → 提交 GitHub */
import { config, nameToRegex, renderName } from "../lib/config.js";
import {
	encodeRepoPath,
	githubFetch,
	json,
	requireAuth,
} from "../lib/shared.js";

/* ---------- 时间：一律 Asia/Shanghai ---------- */

function shanghaiNow() {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).formatToParts(new Date());
	const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
	const y = get("year");
	const mo = get("month");
	const d = get("day");
	const h = get("hour") === "24" ? "00" : get("hour");
	const mi = get("minute");
	const s = get("second");
	return {
		date: `${y}-${mo}-${d}`,
		dateStamp: `${y}${mo}${d}`,
		time: `${h}:${mi}`,
		timeStamp: `${h}${mi}`,
		datetime: `${y}-${mo}-${d} ${h}:${mi}:${s}`,
	};
}

function yamlStr(value) {
	return JSON.stringify(String(value));
}

/* ---------- frontmatter（字段顺序与常见文章 schema 一致，留空不写） ---------- */

function buildFrontmatter(type, fields, now) {
	const lines = ["---"];

	if (type === "dynamic") {
		lines.push(`published: ${now.datetime}`);
		if (fields.location) lines.push(`location: ${yamlStr(fields.location)}`);
		if (fields.pinned) lines.push("pinned: true");
		lines.push("---");
		return `${lines.join("\n")}\n`;
	}

	// post / update
	lines.push(`title: ${yamlStr(fields.title)}`);
	lines.push(`published: ${now.date}`);
	if (fields.updated) lines.push(`updated: ${fields.updated}`);
	if (fields.description)
		lines.push(`description: ${yamlStr(fields.description)}`);
	if (fields.image) lines.push(`image: ${yamlStr(fields.image)}`);
	if (fields.tags?.length) lines.push(`tags: ${JSON.stringify(fields.tags)}`);
	if (fields.category) lines.push(`category: ${yamlStr(fields.category)}`);
	if (fields.draft) lines.push("draft: true");
	if (fields.pinned) lines.push("pinned: true");
	if (fields.slug) lines.push(`slug: ${yamlStr(fields.slug)}`);
	if (fields.lang) lines.push(`lang: ${yamlStr(fields.lang)}`);
	if (fields.author) lines.push(`author: ${yamlStr(fields.author)}`);
	if (fields.comment !== null) lines.push(`comment: ${fields.comment}`);
	if (fields.licenseName)
		lines.push(`licenseName: ${yamlStr(fields.licenseName)}`);
	if (fields.licenseUrl)
		lines.push(`licenseUrl: ${yamlStr(fields.licenseUrl)}`);
	if (fields.sourceLink)
		lines.push(`sourceLink: ${yamlStr(fields.sourceLink)}`);
	if (fields.password) lines.push(`password: ${yamlStr(fields.password)}`);
	if (fields.passwordHint)
		lines.push(`passwordHint: ${yamlStr(fields.passwordHint)}`);
	if (fields.series) lines.push(`series: ${yamlStr(fields.series)}`);
	if (fields.seriesOrder !== null && fields.seriesOrder !== undefined)
		lines.push(`seriesOrder: ${fields.seriesOrder}`);
	lines.push("---");
	return `${lines.join("\n")}\n`;
}

/* ---------- 路径生成（全部来自配置，现场查仓库不缓存） ---------- */

async function fileExists(path, token) {
	const { status, ok } = await githubFetch(
		"GET",
		`/repos/${config.repo}/contents/${encodeRepoPath(path)}?ref=${config.branch}`,
		token,
	);
	if (status === 404) return false;
	if (!ok) throw new Error(`GitHub 查文件失败（HTTP ${status}）`);
	return true;
}

async function uniquePath(basePath, token) {
	// 冲突时追加 -2、-3 …… 直到不存在
	const dot = basePath.lastIndexOf(".");
	const stem = basePath.slice(0, dot);
	const ext = basePath.slice(dot);
	for (let n = 1; n <= 99; n++) {
		const candidate = n === 1 ? basePath : `${stem}-${n}${ext}`;
		if (!(await fileExists(candidate, token))) return candidate;
	}
	throw new Error("同名文件冲突过多，停止发布");
}

async function resolvePath(type, token, now) {
	if (type === "post") {
		const dir = config.postDir;
		const tpl = config.postName;
		const { status, ok, data } = await githubFetch(
			"GET",
			`/repos/${config.repo}/contents/${encodeRepoPath(dir)}?ref=${config.branch}`,
			token,
		);
		if (!ok) {
			throw new Error(
				status === 404
					? `文章目录不存在：${dir}（检查 PUB_POST_DIR / GITHUB_REPO 配置）`
					: `GitHub 列目录失败（HTTP ${status}）：${data.message || "unknown"}`,
			);
		}
		const regex = nameToRegex(tpl);
		let max = 0;
		if (regex && Array.isArray(data)) {
			for (const e of data) {
				const m = regex.exec(e.name);
				if (m) max = Math.max(max, Number(m[1]));
			}
		}
		return `${dir}/${renderName(tpl, { n: max + 1, date: now.dateStamp, time: now.timeStamp })}`;
	}
	if (type === "update") {
		return uniquePath(
			`${config.updateDir}/${renderName(config.updateName, { date: now.dateStamp, time: now.timeStamp })}`,
			token,
		);
	}
	return uniquePath(
		`${config.dynamicDir}/${renderName(config.dynamicName, { date: now.dateStamp, time: now.timeStamp })}`,
		token,
	);
}

async function createFile(path, content, message, token) {
	const { status, ok, data } = await githubFetch(
		"PUT",
		`/repos/${config.repo}/contents/${encodeRepoPath(path)}`,
		token,
		{
			message,
			content: Buffer.from(content, "utf8").toString("base64"),
			branch: config.branch,
		},
	);
	if (!ok) {
		throw Object.assign(
			new Error(
				`GitHub 提交失败（HTTP ${status}）：${data.message || "unknown"}`,
			),
			{ status: status >= 400 && status < 500 ? status : 502 },
		);
	}
	return data;
}

/* ---------- handler ---------- */

function badRequest(res, message) {
	json(res, 400, { ok: false, error: message });
}

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.statusCode = 405;
		res.setHeader("Allow", "POST");
		res.end("Method Not Allowed");
		return;
	}
	const auth = requireAuth(req, res);
	if (!auth) return;
	const githubToken = auth.githubToken;

	let body;
	try {
		body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
	} catch {
		badRequest(res, "请求体不是合法 JSON");
		return;
	}
	body = body || {};

	const type = body.type;
	if (!["post", "update", "dynamic"].includes(type)) {
		badRequest(res, "type 必须是 post / update / dynamic 之一");
		return;
	}
	const content = String(body.content ?? "").trim();
	if (!content) {
		badRequest(res, "正文内容不能为空");
		return;
	}
	const title = String(body.title ?? "").trim();
	if (type === "post" && !title) {
		badRequest(res, "标题不能为空");
		return;
	}
	const now = shanghaiNow();
	const finalTitle =
		type === "update"
			? title || renderName(config.updateName, { date: now.dateStamp })
			: title;

	const tags = Array.isArray(body.tags)
		? body.tags.map((t) => String(t).trim()).filter(Boolean)
		: String(body.tags ?? "")
				.split(/[,，]/)
				.map((t) => t.trim())
				.filter(Boolean);

	// updated 必须是 YYYY-MM-DD（原样写入 frontmatter，需 YAML 可解析为日期）
	const updated = String(body.updated ?? "").trim();
	if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
		badRequest(res, "updated 必须是 YYYY-MM-DD 格式的日期");
		return;
	}
	const seriesOrderRaw = String(body.seriesOrder ?? "").trim();
	const seriesOrder = seriesOrderRaw === "" ? null : Number(seriesOrderRaw);
	if (seriesOrder !== null && !Number.isFinite(seriesOrder)) {
		badRequest(res, "seriesOrder 必须是数字");
		return;
	}
	const str = (v) => String(v ?? "").trim();

	const fields = {
		title: finalTitle,
		updated,
		description: str(body.description),
		image: str(body.image),
		category: str(body.category),
		slug: str(body.slug),
		lang: str(body.lang),
		author: str(body.author),
		licenseName: str(body.licenseName),
		licenseUrl: str(body.licenseUrl),
		sourceLink: str(body.sourceLink),
		password: str(body.password),
		passwordHint: str(body.passwordHint),
		series: str(body.series),
		seriesOrder,
		comment:
			body.comment === "true" ? true : body.comment === "false" ? false : null,
		location: str(body.location),
		draft: Boolean(body.draft),
		pinned: Boolean(body.pinned),
		tags,
	};

	try {
		const path = await resolvePath(type, githubToken, now);
		const markdown = `${buildFrontmatter(type, fields, now)}\n${content}\n`;
		const message =
			type === "post"
				? `post: ${finalTitle}`
				: type === "update"
					? `update: ${finalTitle}`
					: `dynamic: ${path
							.split("/")
							.pop()
							.replace(/\.mdx?$/, "")}`;
		await createFile(path, markdown, message, githubToken);

		json(res, 200, {
			ok: true,
			path,
			message: `已提交到 ${config.branch}（${path}），自动构建约 3~5 分钟后生效`,
		});
	} catch (err) {
		json(
			res,
			err.status && err.status >= 400 && err.status < 500 ? err.status : 502,
			{ ok: false, error: err.message || "发布失败" },
		);
	}
}

// 便于本地测试引用（Vercel 忽略额外导出）
export { buildFrontmatter, shanghaiNow };
