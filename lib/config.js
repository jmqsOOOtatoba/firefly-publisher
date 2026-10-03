/* 全部可配置项：默认值 = Firefly 博客的约定，其他博客通过环境变量覆盖 */

function env(key) {
	const v = process.env[key];
	return v === undefined || v === "" ? undefined : v.trim();
}

function required(key, pattern, hint) {
	const v = env(key);
	if (!v || (pattern && !pattern.test(v))) {
		throw new Error(`缺少或非法的环境变量 ${key}${hint ? `（${hint}）` : ""}`);
	}
	return v;
}

export const config = {
	/** 目标仓库，必填，格式 owner/repo */
	get repo() {
		return required("GITHUB_REPO", /^[^/\s]+\/[^/\s]+$/, "格式 owner/repo");
	},
	get branch() {
		return env("GITHUB_BRANCH") || "master";
	},

	/** 文章：目录 + 文件名模板（{n} = 顺延序号） */
	get postDir() {
		return env("PUB_POST_DIR") || "src/content/posts/txt";
	},
	get postName() {
		return env("PUB_POST_NAME") || "{n}文章.md";
	},

	/** 更新公告：目录 + 文件名模板（{date} = YYYYMMDD） */
	get updateDir() {
		return env("PUB_UPDATE_DIR") || "src/content/posts/update";
	},
	get updateName() {
		return env("PUB_UPDATE_NAME") || "更新公告{date}.md";
	},

	/** 动态：目录 + 文件名模板（{date} = YYYYMMDD，{time} = HHmm） */
	get dynamicDir() {
		return env("PUB_DYNAMIC_DIR") || "src/content/dynamic";
	},
	get dynamicName() {
		return env("PUB_DYNAMIC_NAME") || "{date}-{time}.md";
	},

	/** 读/写/删白名单：允许操作的目录前缀（逗号分隔，须以 / 结尾） */
	get allowedPrefixes() {
		const raw = env("PUB_ALLOWED") || "src/content/posts/,src/content/dynamic/";
		return raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => (s.endsWith("/") ? s : `${s}/`));
	},
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 把含 {n} 的文件名模板转成捕获序号的正则，如 {n}文章.md → /^(\d+)文章\.md$/ */
export function nameToRegex(template) {
	const i = template.indexOf("{n}");
	if (i < 0) return null;
	return new RegExp(
		`^${escRe(template.slice(0, i))}(\\d+)${escRe(template.slice(i + 3))}$`,
	);
}

/** 渲染文件名模板 */
export function renderName(template, { n, date, time }) {
	return template
		.replaceAll("{n}", String(n))
		.replaceAll("{date}", date ?? "")
		.replaceAll("{time}", time ?? "");
}
