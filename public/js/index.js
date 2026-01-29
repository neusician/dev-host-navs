// ============ 全局状态 ============
let hostConfig = null;
let currentGroup = -1;
let viewMode = "card";
let searchKeyword = "";

// ============ 配置加载 ============
async function loadConfig(password) {
  const response = await fetch("host-" + password + ".conf");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const yamlText = await response.text();

  // 使用 js-yaml 库解析 YAML
  const config = jsyaml.load(yamlText);

  // 验证配置结构
  if (!config || typeof config !== "object") {
    throw new Error("配置文件格式错误：不是有效的YAML对象");
  }
  if (!config.name) {
    throw new Error("配置文件缺少必要字段：name");
  }
  if (!Array.isArray(config.navs)) {
    throw new Error("配置文件缺少必要字段：navs (应为数组)");
  }

  // 规范化配置
  const normalizedConfig = {
    name: config.name,
    description: config.description || "",
    console_output: config.console_output === true,
    use_text_icon: config.use_text_icon === true,
    use_google_favicon: config.use_google_favicon === true,
    navs: config.navs.map((nav, index) => {
      if (!nav.name) {
        throw new Error(`第 ${index + 1} 个分组缺少 name 字段`);
      }
      return {
        name: nav.name,
        description: nav.description || "",
        items: Array.isArray(nav.items)
          ? nav.items.map((item) => ({
              name: item.name || "未命名链接",
              short_name: item.short_name || "",
              description: item.description || "",
              nav_to: item.nav_to || "#",
            }))
          : [],
      };
    }),
    fixed_navs: (function () {
      const f = config.fixed_navs;
      if (!f || typeof f !== "object") return null;
      const normalizePos = (v) => {
        if (v === undefined || v === null) return undefined;
        return typeof v === "number" ? `${v}px` : String(v);
      };
      const fixed = f.fixed || {};
      return {
        fixed: {
          top: normalizePos(fixed.top),
          right: normalizePos(fixed.right),
          bottom: normalizePos(fixed.bottom),
          left: normalizePos(fixed.left),
        },
        items: Array.isArray(f.items)
          ? f.items.map((item) => ({
              name: item.name || "未命名链接",
              short_name: item.short_name || "",
              description: item.description || "",
              nav_to: item.nav_to || "#",
            }))
          : [],
      };
    })(),
  };

  return normalizedConfig;
}

// ============ 图标获取策略 ============

// 获取网站原生 favicon 地址（多种可能路径）
function getNativeFaviconUrls(url) {
  try {
    const urlObj = new URL(url);
    const origin = urlObj.origin;
    return [
      `${origin}/favicon.ico`,
      `${origin}/favicon.png`,
      `${origin}/favicon.svg`,
      `${origin}/apple-touch-icon.png`,
      `${origin}/assets/favicon.ico`,
      `${origin}/static/favicon.ico`,
      `${origin}/images/favicon.ico`,
    ];
  } catch {
    return [];
  }
}

// 获取 Google favicon 服务地址
function getGoogleFaviconUrl(url) {
  try {
    const urlObj = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
  } catch {
    return null;
  }
}

// 生成文字缩写（支持中英文）
function getTextAbbr(item) {
  const name = item.name;
  const shortName = item.short_name;
  // 优先使用配置的简称
  if (shortName && shortName.trim()) {
    return shortName.trim().slice(0, 4);
  }

  if (!name) return "?";

  const cleanName = name.trim();

  // 中文：取前两个字
  const chineseMatch = cleanName.match(/[\u4e00-\u9fa5]/g);
  if (chineseMatch && chineseMatch.length >= 2) {
    return chineseMatch.slice(0, 2).join("");
  }
  if (chineseMatch && chineseMatch.length === 1) {
    return chineseMatch[0];
  }

  // 英文：取单词首字母（最多2个）或前两个字符
  const words = cleanName.split(/[\s\-_\/]+/).filter((w) => w.length > 0);
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  } else if (words.length === 1) {
    return cleanName.slice(0, 2).toUpperCase();
  }

  return cleanName.slice(0, 2).toUpperCase();
}

// 图标加载失败处理（全局函数）
function handleFaviconError(img, abbr) {
  const fallbacks = JSON.parse(img.dataset.fallbacks || "[]");

  if (fallbacks.length > 0) {
    // 尝试下一个备选源
    img.src = fallbacks[0];
    img.dataset.fallbacks = JSON.stringify(fallbacks.slice(1));
  } else {
    // 所有源都失败，显示文字
    img.classList.add("hidden");
    const textSpan = img.parentElement.querySelector(".favicon-text");
    if (textSpan) {
      textSpan.classList.remove("hidden");
    }
  }
}

// ============ 渲染图标组件 ============
function renderFavicon(item, size = "normal") {
  const sizeClasses = {
    normal: {
      container: "w-12 h-12 rounded-xl",
      img: "w-7 h-7",
      text: "text-lg",
    },
    small: {
      container: "w-10 h-10 rounded-lg",
      img: "w-6 h-6",
      text: "text-base",
    },
  };

  const classes = sizeClasses[size] || sizeClasses.normal;
  const abbr = getTextAbbr(item);

  // 纯文本图标模式 - 直接返回文字
  if (hostConfig.use_text_icon) {
    return `
            <div class="${classes.container} bg-gradient-to-br from-primary/10 to-secondary/10 
                flex items-center justify-center flex-shrink-0
                group-hover:from-primary/20 group-hover:to-secondary/20 transition-all">
                <span class="${classes.text} font-bold text-primary">${abbr}</span>
            </div>
        `;
  }

  // 根据配置决定图标获取策略
  let imgSources = [];
  if (hostConfig.use_google_favicon) {
    const googleUrl = getGoogleFaviconUrl(item.nav_to);
    if (googleUrl) {
      imgSources = [googleUrl];
    }
  } else {
    imgSources = getNativeFaviconUrls(item.nav_to);
  }

  // 生成带降级策略的图标 HTML
  if (imgSources.length > 0) {
    const fallbacksJson = JSON.stringify(imgSources.slice(1)).replace(
      /'/g,
      "\\'"
    );
    return `
            <div class="${classes.container} bg-gradient-to-br from-gray-50 to-gray-100 
                flex items-center justify-center flex-shrink-0 overflow-hidden
                group-hover:from-primary/10 group-hover:to-secondary/10 transition-all">
                <img 
                    src="${imgSources[0]}" 
                    alt="" 
                    class="${classes.img} object-contain favicon-img"
                    data-fallbacks='${fallbacksJson}'
                    onerror="handleFaviconError(this, '${abbr}')"
                    loading="lazy"
                >
                <span class="${classes.text} font-bold text-primary hidden favicon-text">${abbr}</span>
            </div>
        `;
  } else {
    return `
            <div class="${classes.container} bg-gradient-to-br from-gray-50 to-gray-100 
                flex items-center justify-center flex-shrink-0
                group-hover:from-primary/10 group-hover:to-secondary/10 transition-all">
                <span class="${classes.text} font-bold text-primary">${abbr}</span>
            </div>
        `;
  }
}

// ============ 高亮关键词 ============
function highlightKeyword(text) {
  if (!searchKeyword || !text) return text;
  const escaped = searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(
    regex,
    '<mark class="bg-yellow-200 text-yellow-900 rounded px-0.5">$1</mark>'
  );
}

// ============ 渲染分组标签 ============
function renderTabs() {
  const container = document.getElementById("nav-tabs");

  // 计算所有链接总数
  const totalItems = hostConfig.navs.reduce(
    (sum, nav) => sum + nav.items.length,
    0
  );

  // 添加"全部"标签
  const allTab = `
                <button 
                    onclick="selectGroup(-1)"
                    class="px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                        ${
                          currentGroup === -1
                            ? "bg-primary text-white shadow-md shadow-primary/30"
                            : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                        }"
                >
                    All
                    <span class="ml-1.5 px-1.5 py-0.5 rounded-full text-xs 
                        ${
                          currentGroup === -1
                            ? "bg-white/20 text-white"
                            : "bg-gray-100 text-gray-500"
                        }">
                        ${totalItems}
                    </span>
                </button>
            `;

  container.innerHTML =
    allTab +
    hostConfig.navs
      .map(
        (nav, index) => `
                <button 
                    onclick="selectGroup(${index})"
                    class="px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap
                        ${
                          index === currentGroup
                            ? "bg-primary text-white shadow-md shadow-primary/30"
                            : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
                        }"
                >
                    ${nav.name}
                    <span class="ml-1.5 px-1.5 py-0.5 rounded-full text-xs 
                        ${
                          index === currentGroup
                            ? "bg-white/20 text-white"
                            : "bg-gray-100 text-gray-500"
                        }">
                        ${nav.items.length}
                    </span>
                </button>
            `
      )
      .join("");
}

// ============ 渲染卡片视图 ============
function renderCardView(item) {
  return `
          <a href="${
            item.nav_to
          }" target="_blank" rel="noopener noreferrer"
              class="card-hover block p-5 bg-white rounded-xl border border-gray-100 shadow-sm group">
              <div class="flex items-start gap-4">
                  ${renderFavicon(item, "normal")}
                  <div class="flex-1 min-w-0">
                      <h3 class="font-semibold text-gray-800 group-hover:text-primary transition-colors truncate">
                          ${highlightKeyword(item.name)}
                      </h3>
                      <p class="text-sm text-gray-500 mt-1 line-clamp-2">
                          ${highlightKeyword(item.description)}
                      </p>
                  </div>
                  <svg class="w-5 h-5 text-gray-300 group-hover:text-primary group-hover:translate-x-1 
                      transition-all flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                  </svg>
              </div>
          </a>
      `;
}

// ============ 渲染列表视图 ============
function renderListView(item) {
  return `
          <a href="${
            item.nav_to
          }" target="_blank" rel="noopener noreferrer"
              class="card-hover flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm group">
              ${renderFavicon(item, "small")}
              <div class="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <h3 class="font-semibold text-gray-800 group-hover:text-primary transition-colors 
                      truncate sm:w-48 flex-shrink-0">
                      ${highlightKeyword(item.name)}
                  </h3>
                  <p class="text-sm text-gray-500 truncate flex-1">
                      ${highlightKeyword(item.description)}
                  </p>
              </div>
              <svg class="w-5 h-5 text-gray-300 group-hover:text-primary group-hover:translate-x-1 
                  transition-all flex-shrink-0 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
          </a>
      `;
}

// ============ 渲染链接列表 ============
function renderLinks() {
  const container = document.getElementById("links-container");
  const noResults = document.getElementById("no-results");
  const groupInfo = document.getElementById("group-info");

  // 获取当前要显示的链接
  let items = [];
  let totalItems = 0;
  let navName = "All";
  let navDescription = "Show all links from all groups | 显示所有分组的链接";

  if (currentGroup === -1) {
    // 显示全部链接
    items = hostConfig.navs.flatMap((nav) => nav.items);
    totalItems = items.length;
  } else {
    // 显示特定分组链接
    const nav = hostConfig.navs[currentGroup];
    items = nav.items;
    totalItems = nav.items.length;
    navName = nav.name;
    navDescription = nav.description;
  }

  // 更新分组信息
  document.getElementById("group-name").textContent = navName;
  document.getElementById("group-description").textContent = navDescription;

  // 过滤链接
  let filteredItems = items;
  if (searchKeyword) {
    const keyword = searchKeyword.toLowerCase();
    filteredItems = items.filter(
      (item) =>
        item.name.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword) ||
        item.nav_to.toLowerCase().includes(keyword)
    );
  }

  // 更新计数
  document.getElementById("group-count").textContent = searchKeyword
    ? `找到 ${filteredItems.length} 个匹配结果（共 ${totalItems} 个链接）`
    : `共 ${filteredItems.length} 个链接`;

  // 显示/隐藏无结果提示
  if (filteredItems.length === 0) {
    container.classList.add("hidden");
    noResults.classList.remove("hidden");
    groupInfo.classList.remove("hidden");
    return;
  } else {
    container.classList.remove("hidden");
    noResults.classList.add("hidden");
    groupInfo.classList.remove("hidden");
  }

  // 根据视图模式设置网格和渲染内容
  if (viewMode === "card") {
    container.className =
      "grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
    container.innerHTML = filteredItems
      .map((item) => renderCardView(item))
      .join("");
  } else {
    container.className = "grid gap-3 grid-cols-1";
    container.innerHTML = filteredItems
      .map((item) => renderListView(item))
      .join("");
  }
}

function renderFixedNavs() {
  const container = document.getElementById("fixed-navs");
  if (!container) return;
  if (!hostConfig || !hostConfig.fixed_navs || !hostConfig.fixed_navs.items || hostConfig.fixed_navs.items.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");

  // 重置位置样式
  container.style.top = "";
  container.style.right = "";
  container.style.bottom = "";
  container.style.left = "";

  const pos = hostConfig.fixed_navs.fixed || {};
  if (pos.top) container.style.top = pos.top;
  if (pos.right) container.style.right = pos.right;
  if (pos.bottom) container.style.bottom = pos.bottom;
  if (pos.left) container.style.left = pos.left;

  container.innerHTML = hostConfig.fixed_navs.items
    .map((item) => {
      const title = item.name || item.nav_to;
      return `<a href="${item.nav_to}" target="_blank" rel="noopener noreferrer" title="${title}" class="group block transition-transform hover:scale-105">${renderFavicon(item, "small")}</a>`;
    })
    .join("");
}

// ============ 选择分组 ============
function selectGroup(index) {
  currentGroup = index;
  renderTabs();
  renderLinks();
}

// ============ 设置视图模式 ============
function setViewMode(mode) {
  viewMode = mode;

  const cardBtn = document.getElementById("view-card");
  const listBtn = document.getElementById("view-list");

  if (mode === "card") {
    cardBtn.classList.add("bg-primary", "text-white");
    cardBtn.classList.remove("text-gray-600");
    listBtn.classList.remove("bg-primary", "text-white");
    listBtn.classList.add("text-gray-600");
  } else {
    listBtn.classList.add("bg-primary", "text-white");
    listBtn.classList.remove("text-gray-600");
    cardBtn.classList.remove("bg-primary", "text-white");
    cardBtn.classList.add("text-gray-600");
  }

  renderLinks();
}

// ============ 搜索处理 ============
function handleSearch(e) {
  searchKeyword = e.target.value.trim();
  const clearBtn = document.getElementById("clear-search");
  clearBtn.classList.toggle("hidden", !searchKeyword);
  renderLinks();
}

function clearSearch() {
  const input = document.getElementById("search-input");
  input.value = "";
  searchKeyword = "";
  document.getElementById("clear-search").classList.add("hidden");
  renderLinks();
  input.focus();
}

// ============ 显示错误 ============
function showError(message, detail) {
  document.getElementById("host-name").textContent = "加载失败";
  document.getElementById("host-description").textContent = message;
  document.getElementById("error-message").classList.remove("hidden");
  document.getElementById("error-detail").textContent = detail;
  document.getElementById("nav-tabs").innerHTML = "";
  document.getElementById("group-info").classList.add("hidden");
}

// ============ 初始化应用 ============
async function init(password) {
  try {
    // 加载并解析配置文件
    hostConfig = await loadConfig(password);

    if (hostConfig.console_output) {
      // 调试输出
      console.log("✅ 配置文件解析成功:", hostConfig);
      console.log(`📁 共 ${hostConfig.navs.length} 个分组`);
      console.log(
        `🖼️ 图标模式: ${
          hostConfig.use_text_icon
            ? "文本简称"
            : hostConfig.use_google_favicon
            ? "谷歌接口 Google Favicon API"
            : "原生网站 Favicon"
        }`
      );
      hostConfig.navs.forEach((nav, i) => {
        console.log(`   ${i + 1}. ${nav.name} (${nav.items.length} 个链接)`);
      });
      if (hostConfig.fixed_navs && hostConfig.fixed_navs.items && hostConfig.fixed_navs.items.length) {
        console.log(`📌 固定导航: ${hostConfig.fixed_navs.items.length} 个`);
      }
    }

    // 更新页面标题和头部信息
    document.title = hostConfig.name;
    document.getElementById("host-name").textContent = hostConfig.name;
    document.getElementById("host-description").textContent =
      hostConfig.description || "";

    // 渲染内容
    renderTabs();
    renderLinks();
    renderFixedNavs();

    // 绑定搜索事件
    document
      .getElementById("search-input")
      .addEventListener("input", handleSearch);

    // 支持回车搜索
    document.getElementById("search-input").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearSearch();
      }
    });

    // 初始化视图模式样式
    setViewMode("card");
  } catch (error) {
    console.error("❌ 初始化失败:", error);
    showError("请检查配置文件", error.message);
  }
}

const encodedPassword = "TmV1c2ljaWFuMjAyNQ==";
const correctPassword = atob(encodedPassword);

function checkStoredPassword() {
  const storedPassword = localStorage.getItem('storedPassword');
  if (storedPassword) {
    document.getElementById('password').value = atob(storedPassword);
    document.getElementById('remember-password').checked = true;
  }
}

function validatePassword(password) {
  const loginScreen = document.getElementById("login-screen");
  const pageContent = document.getElementById("page-content");
  const loginError = document.getElementById("login-error");
  const rememberPassword = document.getElementById('remember-password').checked;

  if (password === correctPassword) {
    if (rememberPassword) {
      localStorage.setItem('storedPassword', btoa(password));
    } else {
      localStorage.removeItem('storedPassword');
    }
    
    // Password correct, hide login screen, show page content
    loginScreen.classList.add("hidden");
    pageContent.classList.remove("hidden");
    // Initialize the application after successful login
    init(password);
  } else {
    // Password error, show error message
    loginError.textContent = "Incorrect password, please try again";
    loginError.classList.remove("hidden");
    // Clear input field
    document.getElementById("password").value = "";
    // Focus input field
    document.getElementById("password").focus();
  }
}

// 暴露函数给全局
window.validatePassword = validatePassword;
window.checkStoredPassword = checkStoredPassword;