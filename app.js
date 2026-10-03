/* Firefly 发布台前端逻辑：登录门 / 发布 / 管理（列表·编辑·预览·删除） */
const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "firefly_publish_token"; // 存 sessionStorage：关掉浏览器需重新登录

let token = sessionStorage.getItem(TOKEN_KEY) || "";
let type = "post";
let currentTab = "publish";
let editing = null; // { path, sha, title }

function setBox(id, kind, html) {
	const el = $(id);
	el.className = `result ${kind}`;
	el.innerHTML = html;
}
function hideBox(id) {
	$(id).className = "result hidden";
}
function escapeHtml(s) {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** 统一请求：自动带口令；401 时返回 res 供调用方处理 */
async function api(path, options = {}) {
	const res = await fetch(path, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"x-publish-token": token,
			...(options.headers || {}),
		},
	});
	const data = await res.json().catch(() => ({}));
	return { res, data };
}

/* ---------- 登录 ---------- */

function showLogin(msg) {
	$("view-main").classList.add("hidden");
	$("view-login").classList.remove("hidden");
	if (msg) setBox("login-result", "err", msg);
}
async function showMain() {
	$("view-login").classList.add("hidden");
	$("view-main").classList.remove("hidden");
}
function logout(msg) {
	token = "";
	sessionStorage.removeItem(TOKEN_KEY);
	showLogin(msg || "");
}
function handle401(res) {
	if (res.status === 401) {
		logout("登录已失效，请重新登录");
		return true;
	}
	return false;
}

async function doLogin() {
	const v = $("login-token").value;
	if (!v) {
		setBox("login-result", "err", "请输入口令");
		return;
	}
	token = v;
	const btn = $("login-btn");
	btn.disabled = true;
	btn.textContent = "登录中…";
	try {
		const { res, data } = await api("/api/auth", {
			method: "POST",
			body: "{}",
		});
		if (res.ok && data.ok) {
			sessionStorage.setItem(TOKEN_KEY, token);
			hideBox("login-result");
			$("login-token").value = "";
			await showMain();
			switchTab(currentTab);
		} else {
			token = "";
			setBox(
				"login-result",
				"err",
				data.error || `登录失败（HTTP ${res.status}）`,
			);
		}
	} catch (e) {
		token = "";
		setBox("login-result", "err", `网络错误：${e.message}`);
	} finally {
		btn.disabled = false;
		btn.textContent = "登录";
	}
}

$("login-btn").addEventListener("click", doLogin);
$("login-token").addEventListener("keydown", (e) => {
	if (e.key === "Enter") doLogin();
});
$("logout-btn").addEventListener("click", () => logout());

/* ---------- Tab ---------- */

function switchTab(name) {
	currentTab = name;
	document.querySelectorAll("[data-tab]").forEach((b) => {
		b.classList.toggle("active", b.dataset.tab === name);
	});
	$("tab-publish").classList.toggle("hidden", name !== "publish");
	$("tab-manage").classList.toggle("hidden", name !== "manage");
	if (name === "manage") loadList();
}
document.querySelectorAll("[data-tab]").forEach((b) => {
	b.addEventListener("click", () => switchTab(b.dataset.tab));
});

/* ---------- 发布 ---------- */

const ALL_FIELD_IDS = [
	"f-updated",
	"f-description",
	"f-image",
	"f-tags",
	"f-category",
	"f-draft",
	"f-pinned",
	"f-slug",
	"f-lang",
	"f-author",
	"f-comment",
	"f-licenseName",
	"f-licenseUrl",
	"f-sourceLink",
	"f-password",
	"f-passwordHint",
	"f-series",
	"f-seriesOrder",
	"f-location",
];
const ARTICLE_FIELD_IDS = ALL_FIELD_IDS.filter((id) => id !== "f-location");

const typeConf = {
	post: { title: "文章标题", show: ARTICLE_FIELD_IDS },
	update: { title: "留空则自动命名（更新公告+日期）", show: ARTICLE_FIELD_IDS },
	dynamic: { title: null, show: ["f-pinned", "f-location"] },
};

function applyType(next) {
	type = next;
	const conf = typeConf[next];
	$("title-field").classList.toggle("hidden", !conf.title);
	$("title").placeholder = conf.title || "";
	for (const id of ALL_FIELD_IDS) {
		$(id).classList.toggle("hidden", !conf.show.includes(id));
	}
	document.querySelectorAll("[data-type]").forEach((b) => {
		b.classList.toggle("active", b.dataset.type === next);
	});
}
document.querySelectorAll("[data-type]").forEach((b) => {
	b.addEventListener("click", () => applyType(b.dataset.type));
});
applyType("post");

$("publish").addEventListener("click", async () => {
	const content = $("content").value;
	const title = $("title").value.trim();
	if (type === "post" && !title) {
		setBox("result", "err", "文章标题不能为空");
		return;
	}
	if (!content.trim()) {
		setBox("result", "err", "正文内容不能为空");
		return;
	}

	const payload = {
		type,
		title,
		content,
		updated: $("updated").value,
		description: $("description").value,
		image: $("image").value,
		tags: $("tags").value,
		category: $("category").value,
		draft: $("draft").checked,
		pinned: $("pinned").checked,
		slug: $("slug").value,
		lang: $("lang").value,
		author: $("author").value,
		comment: $("comment").value,
		licenseName: $("licenseName").value,
		licenseUrl: $("licenseUrl").value,
		sourceLink: $("sourceLink").value,
		password: $("password").value,
		passwordHint: $("passwordHint").value,
		series: $("series").value,
		seriesOrder: $("seriesOrder").value,
		location: $("location").value,
	};

	const btn = $("publish");
	btn.disabled = true;
	btn.textContent = "发布中…";
	try {
		const { res, data } = await api("/api/publish", {
			method: "POST",
			body: JSON.stringify(payload),
		});
		if (handle401(res)) return;
		if (res.ok && data.ok) {
			setBox(
				"result",
				"ok",
				`已提交 · ${data.message}<br/>文件：<code>${data.path}</code>`,
			);
			// 清空与文章一对一的字段，保留可复用的设置类字段（标签/分类/作者/系列）
			for (const id of [
				"title",
				"content",
				"slug",
				"updated",
				"description",
				"image",
				"lang",
				"licenseName",
				"licenseUrl",
				"sourceLink",
				"password",
				"passwordHint",
				"seriesOrder",
			]) {
				$(id).value = "";
			}
			$("draft").checked = false;
			$("pinned").checked = false;
			$("comment").value = "";
		} else {
			setBox(
				"result",
				"err",
				`发布失败：${data.error || `HTTP ${res.status}`}`,
			);
		}
	} catch (e) {
		setBox("result", "err", `网络错误：${e.message}`);
	} finally {
		btn.disabled = false;
		btn.textContent = "发布";
	}
});

/* ---------- 管理：列表 ---------- */

const seqOf = (name) => {
	const m = String(name).match(/(\d+)(?!.*\d)/);
	return m ? Number(m[1]) : 0;
};

async function loadList() {
	const status = $("mg-status");
	status.textContent = "加载中…";
	let res;
	let data;
	try {
		({ res, data } = await api("/api/articles"));
	} catch (e) {
		status.textContent = `网络错误：${e.message}`;
		return;
	}
	if (handle401(res)) return;
	if (!res.ok || !data.ok) {
		status.textContent = data.error || `加载失败（HTTP ${res.status}）`;
		return;
	}
	renderList(data.items);
	status.textContent = `共 ${data.items.length} 项${data.truncated ? "（文件树被截断，仅部分）" : ""}`;
}

function renderList(items) {
	const groups = { post: [], update: [], dynamic: [] };
	for (const it of items) groups[it.type]?.push(it);
	groups.post.sort(
		(a, b) =>
			seqOf(b.name) - seqOf(a.name) ||
			b.name.localeCompare(a.name, "zh", { numeric: true }),
	);
	groups.update.sort((a, b) =>
		b.name.localeCompare(a.name, "zh", { numeric: true }),
	);
	groups.dynamic.sort((a, b) =>
		b.name.localeCompare(a.name, "zh", { numeric: true }),
	);

	const labels = { post: "文章", update: "更新公告", dynamic: "动态" };
	const html = ["post", "update", "dynamic"]
		.map((k) => {
			if (!groups[k].length) return "";
			const rows = groups[k]
				.map(
					(it) => `
				<button type="button" class="mg-item" data-path="${escapeHtml(it.path)}">
					<span class="t">${escapeHtml(it.title)}</span>
					${it.pinned ? '<span class="badge">置顶</span>' : ""}
					${it.draft ? '<span class="badge draft">草稿</span>' : ""}
					${it.published ? `<span class="n">${escapeHtml(it.published)}</span>` : ""}
					<span class="n">${escapeHtml(it.name)}</span>
				</button>`,
				)
				.join("");
			return `<div class="mg-group"><h4>${labels[k]}（${groups[k].length}）</h4>${rows}</div>`;
		})
		.join("");
	$("mg-groups").innerHTML =
		html || '<div class="mg-group"><h4>暂无内容</h4></div>';
	$("mg-groups")
		.querySelectorAll(".mg-item")
		.forEach((b) => {
			b.addEventListener("click", () => {
				const meta = items.find((i) => i.path === b.dataset.path);
				openEditor(meta);
			});
		});
}

$("mg-refresh").addEventListener("click", loadList);

/* ---------- 管理：编辑 / 预览 / 保存 / 删除 ---------- */

async function openEditor(meta) {
	if (!meta) return;
	$("mg-status").textContent = "读取文件…";
	let res;
	let data;
	try {
		({ res, data } = await api(
			`/api/article?path=${encodeURIComponent(meta.path)}`,
		));
	} catch (e) {
		$("mg-status").textContent = `网络错误：${e.message}`;
		return;
	}
	if (handle401(res)) return;
	if (!res.ok || !data.ok) {
		$("mg-status").textContent = data.error || `读取失败（HTTP ${res.status}）`;
		return;
	}
	editing = { path: meta.path, sha: data.sha, title: meta.title };
	$("mg-status").textContent = "";
	$("mg-file").textContent = meta.path;
	$("mg-content").value = data.content;
	$("mg-list").classList.add("hidden");
	$("mg-editor").classList.remove("hidden");
	$("mg-preview").classList.add("hidden");
	$("mg-preview-btn").textContent = "预览";
	hideBox("mg-result");
}

$("mg-back").addEventListener("click", () => {
	editing = null;
	$("mg-editor").classList.add("hidden");
	$("mg-list").classList.remove("hidden");
});

function renderPreview() {
	const raw = $("mg-content").value;
	const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
	const fmEl = $("mg-fm");
	fmEl.classList.toggle("hidden", !fm);
	fmEl.textContent = fm ? `---\n${fm[1]}\n---` : "";
	const body = fm ? raw.slice(fm[0].length) : raw;
	try {
		const ns = window.marked;
		const parser = ns?.parse ? ns : ns?.marked;
		$("mg-rendered").innerHTML = parser
			? parser.parse(body)
			: `<pre>${escapeHtml(body)}</pre>`;
	} catch {
		$("mg-rendered").innerHTML = `<pre>${escapeHtml(body)}</pre>`;
	}
}

$("mg-preview-btn").addEventListener("click", () => {
	const pv = $("mg-preview");
	const opening = pv.classList.contains("hidden");
	if (opening) renderPreview();
	pv.classList.toggle("hidden", !opening);
	$("mg-preview-btn").textContent = opening ? "收起预览" : "预览";
});

$("mg-save").addEventListener("click", async () => {
	if (!editing) return;
	const btn = $("mg-save");
	btn.disabled = true;
	btn.textContent = "保存中…";
	try {
		const { res, data } = await api("/api/article", {
			method: "PUT",
			body: JSON.stringify({
				path: editing.path,
				content: $("mg-content").value,
				sha: editing.sha,
			}),
		});
		if (handle401(res)) return;
		if (res.ok && data.ok) {
			if (data.sha) editing.sha = data.sha;
			setBox("mg-result", "ok", `已保存 · ${data.message}`);
		} else {
			setBox(
				"mg-result",
				"err",
				data.error || `保存失败（HTTP ${res.status}）`,
			);
		}
	} catch (e) {
		setBox("mg-result", "err", `网络错误：${e.message}`);
	} finally {
		btn.disabled = false;
		btn.textContent = "保存";
	}
});

$("mg-delete").addEventListener("click", async () => {
	if (!editing) return;
	const okDelete = confirm(
		`确认删除《${editing.title}》？\n${editing.path}\n\n删除会直接从仓库移除该文件并触发重建，不可撤销。`,
	);
	if (!okDelete) return;
	const btn = $("mg-delete");
	btn.disabled = true;
	btn.textContent = "删除中…";
	try {
		const { res, data } = await api("/api/article", {
			method: "DELETE",
			body: JSON.stringify({ path: editing.path, sha: editing.sha }),
		});
		if (handle401(res)) return;
		if (res.ok && data.ok) {
			editing = null;
			$("mg-editor").classList.add("hidden");
			$("mg-list").classList.remove("hidden");
			loadList();
			$("mg-status").textContent = data.message || "已删除";
		} else {
			setBox(
				"mg-result",
				"err",
				data.error || `删除失败（HTTP ${res.status}）`,
			);
		}
	} catch (e) {
		setBox("mg-result", "err", `网络错误：${e.message}`);
	} finally {
		btn.disabled = false;
		btn.textContent = "删除";
	}
});

/* ---------- 启动 ---------- */

(async () => {
	if (token) {
		try {
			const { res, data } = await api("/api/auth", {
				method: "POST",
				body: "{}",
			});
			if (res.ok && data.ok) {
				await showMain();
				return;
			}
		} catch {
			/* 网络错误也回登录页，用户可重试 */
		}
		token = "";
		sessionStorage.removeItem(TOKEN_KEY);
	}
	showLogin();
})();
