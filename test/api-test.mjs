// 发布台 API 断言测试（需先启动 local-harness.mjs，监听 8788）
// 运行：node publisher/test/api-test.mjs
const BASE = "http://127.0.0.1:8788";
const TOKEN = "test-pass-123";
const results = [];
const assert = (cond, m) => results.push({ pass: !!cond, m });

async function call(
	path,
	{ method = "GET", token = TOKEN, body, query = "" } = {},
) {
	const res = await fetch(`${BASE}${path}${query}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			"x-publish-token": token,
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	return { status: res.status, data };
}

/* 1. 登录鉴权 */
{
	const wrong = await call("/api/auth", { method: "POST", token: "bad" });
	assert(wrong.status === 401, `错误口令 401（实际 ${wrong.status}）`);
	const right = await call("/api/auth", { method: "POST" });
	assert(right.status === 200 && right.data.ok, "正确口令 200");
}

/* 2. 列表 */
let items = [];
{
	const r = await call("/api/articles");
	assert(r.status === 200 && r.data.ok, "列表 200");
	items = r.data.items ?? [];
	assert(items.length === 4, `初始 4 项（实际 ${items.length}）`);
	const t17 = items.find((i) => i.name === "17文章.md");
	assert(t17?.title === "发布后端测试文章", `17 标题解析（${t17?.title}）`);
	assert(t17?.type === "post" && t17?.sha, "17 类型与 sha");
	const dyn = items.find((i) => i.type === "dynamic");
	assert(dyn?.published === "2026-10-03", `动态日期（${dyn?.published}）`);
	assert(
		items.every(
			(i) => i.type !== "post" || i.path.startsWith("src/content/posts/"),
		),
		"路径过滤正确",
	);
}

/* 3. 读取单篇 + 路径安全 */
{
	const r = await call("/api/article", {
		query: `?path=${encodeURIComponent("src/content/posts/txt/17文章.md")}`,
	});
	assert(r.status === 200 && r.data.ok && r.data.sha, "读取 200 带 sha");
	assert(r.data.content.includes("正文B"), "内容正确");

	const bad = await call("/api/article", {
		query: `?path=${encodeURIComponent("../../etc/passwd")}`,
	});
	assert(bad.status === 400, `非法路径 400（实际 ${bad.status}）`);
	const outside = await call("/api/article", {
		query: `?path=${encodeURIComponent("src/config/siteConfig.ts")}`,
	});
	assert(outside.status === 400, `非内容目录 400（实际 ${outside.status}）`);
}

/* 4. 编辑保存（含 sha 冲突） */
let sha17;
{
	const get = await call("/api/article", {
		query: `?path=${encodeURIComponent("src/content/posts/txt/17文章.md")}`,
	});
	sha17 = get.data.sha;
	const save = await call("/api/article", {
		method: "PUT",
		body: {
			path: "src/content/posts/txt/17文章.md",
			content:
				"---\ntitle: 改过的标题\npublished: 2026-10-03\n---\n\n改过的正文",
			sha: sha17,
		},
	});
	assert(save.status === 200 && save.data.ok, "保存 200");
	assert(save.data.sha && save.data.sha !== sha17, "返回新 sha");

	const again = await call("/api/article", {
		method: "PUT",
		body: {
			path: "src/content/posts/txt/17文章.md",
			content: "x",
			sha: sha17, // 旧 sha
		},
	});
	assert(again.status === 409, `旧 sha 冲突 409（实际 ${again.status}）`);

	const list = await call("/api/articles");
	const t17 = list.data.items.find((i) => i.name === "17文章.md");
	assert(t17?.title === "改过的标题", `列表标题已更新（${t17?.title}）`);
}

/* 5. 发布新文章（编号顺延 17 → 18） */
{
	const r = await call("/api/publish", {
		method: "POST",
		body: {
			type: "post",
			title: "吊床发布测试",
			content: "## 内容",
			tags: "测试",
			category: "技术分享",
			author: "左沐",
		},
	});
	assert(r.status === 200 && r.data.ok, `发布 200（${r.data.error ?? ""}）`);
	assert(
		r.data.path === "src/content/posts/txt/18文章.md",
		`编号顺延 18（实际 ${r.data.path}）`,
	);
	const list = await call("/api/articles");
	assert(list.data.items.length === 5, "发布后列表 5 项");
}

/* 6. 发布非法 updated 拒绝 */
{
	const r = await call("/api/publish", {
		method: "POST",
		body: { type: "post", title: "t", content: "c", updated: "2026/10/03" },
	});
	assert(r.status === 400, `非法 updated 400（实际 ${r.status}）`);
}

/* 7. 删除（含校验） */
{
	const get = await call("/api/article", {
		query: `?path=${encodeURIComponent("src/content/posts/txt/18文章.md")}`,
	});
	assert(get.status === 200, "读取新文章");
	const del = await call("/api/article", {
		method: "DELETE",
		body: { path: "src/content/posts/txt/18文章.md", sha: get.data.sha },
	});
	assert(del.status === 200 && del.data.ok, "删除 200");
	const gone = await call("/api/article", {
		query: `?path=${encodeURIComponent("src/content/posts/txt/18文章.md")}`,
	});
	assert(gone.status === 404, `删除后 404（实际 ${gone.status}）`);
	const list = await call("/api/articles");
	assert(list.data.items.length === 4, "删除后列表 4 项");

	const noSha = await call("/api/article", {
		method: "DELETE",
		body: { path: "src/content/posts/txt/17文章.md" },
	});
	assert(noSha.status === 400, `缺 sha 400（实际 ${noSha.status}）`);
}

/* 8. 配置模板纯函数 */
{
	const { nameToRegex, renderName } = await import("../lib/config.js");
	const re = nameToRegex("{n}文章.md");
	assert(re?.exec("17文章.md")?.[1] === "17", "模板正则匹配 17文章.md");
	assert(re && !re.test("abc.md"), "模板正则拒绝无序号文件");
	assert(re?.exec("post-5.mdx") === null, "模板不匹配错误后缀");
	const re2 = nameToRegex("post-{n}.md");
	assert(re2?.exec("post-5.md")?.[1] === "5", "英文命名模板可用");
	assert(renderName("post-{n}.md", { n: 5 }) === "post-5.md", "renderName {n}");
	assert(
		renderName("更新公告{date}.md", { date: "20261003" }) ===
			"更新公告20261003.md",
		"renderName {date}",
	);
	assert(
		renderName("{date}-{time}.md", { date: "20261003", time: "1217" }) ===
			"20261003-1217.md",
		"renderName {date}-{time}",
	);
}

let fail = 0;
for (const r of results) {
	if (!r.pass) fail++;
	console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.m}`);
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
