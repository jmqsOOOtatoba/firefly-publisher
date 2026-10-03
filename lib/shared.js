/* 发布台端点共享工具：鉴权、GitHub 调用、路径安全。配置项见 ./config.js */

import crypto from "node:crypto";
import { config } from "./config.js";

export { config };

const GITHUB_API = "https://api.github.com";

export function json(res, status, data) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(data));
}

export function safeEqual(a, b) {
	const ab = Buffer.from(String(a ?? ""), "utf8");
	const bb = Buffer.from(String(b ?? ""), "utf8");
	if (ab.length !== bb.length) return false;
	return crypto.timingSafeEqual(ab, bb);
}

/** 校验环境变量与口令；失败时已写出响应并返回 null */
export function requireAuth(req, res) {
	const publishToken = process.env.PUBLISH_TOKEN;
	const githubToken = process.env.GITHUB_TOKEN;
	if (!publishToken || !githubToken) {
		json(res, 500, {
			ok: false,
			error: "服务端未配置 PUBLISH_TOKEN / GITHUB_TOKEN 环境变量",
		});
		return null;
	}
	try {
		config.repo; // GITHUB_REPO 必填，缺失时给出明确错误
	} catch (e) {
		json(res, 500, { ok: false, error: e.message });
		return null;
	}
	if (!safeEqual(req.headers["x-publish-token"], publishToken)) {
		json(res, 401, { ok: false, error: "口令错误" });
		return null;
	}
	return { publishToken, githubToken };
}

export function encodeRepoPath(path) {
	return path.split("/").map(encodeURIComponent).join("/");
}

export function githubHeaders(token) {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "firefly-publisher",
	};
}

export async function githubFetch(method, apiPath, token, body) {
	const res = await fetch(`${GITHUB_API}${apiPath}`, {
		method,
		headers: {
			...githubHeaders(token),
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	return { status: res.status, ok: res.ok, data };
}

/** 只允许白名单目录下的 markdown 路径，防任意文件读写删 */
export function isSafeContentPath(p) {
	if (typeof p !== "string" || !p) return false;
	if (p.includes("..") || p.startsWith("/") || p.includes("//")) return false;
	if (!/\.(md|mdx)$/.test(p)) return false;
	return config.allowedPrefixes.some((pre) => p.startsWith(pre));
}
