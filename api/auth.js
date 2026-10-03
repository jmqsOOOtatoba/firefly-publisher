import { config, json, safeEqual } from "../lib/shared.js";

export default function handler(req, res) {
	if (req.method !== "POST") {
		res.statusCode = 405;
		res.setHeader("Allow", "POST");
		res.end("Method Not Allowed");
		return;
	}
	const publishToken = process.env.PUBLISH_TOKEN;
	if (!publishToken || !process.env.GITHUB_TOKEN) {
		json(res, 500, {
			ok: false,
			error: "服务端未配置 PUBLISH_TOKEN / GITHUB_TOKEN 环境变量",
		});
		return;
	}
	try {
		config.repo; // 登录时即校验 GITHUB_REPO，配置缺失第一时间暴露
	} catch (e) {
		json(res, 500, { ok: false, error: e.message });
		return;
	}
	if (!safeEqual(req.headers["x-publish-token"], publishToken)) {
		json(res, 401, { ok: false, error: "口令错误" });
		return;
	}
	json(res, 200, { ok: true });
}
