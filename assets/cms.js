/* ============================================================
   Im-chc CMS · GitHub-as-Backend 内容管理脚本
   通过 GitHub Contents API 读写 data/posts.json，实现
   「网页编辑 → 仓库变动 → Actions 自动重新部署」闭环
   ============================================================ */
(function (global) {
  'use strict';

  var CONFIG = {
    owner: 'hongchichen',
    repo: 'im-chc',
    branch: 'main',
    filePath: 'data/posts.json',
    tokenKey: 'im_gh_token'
  };

  var API = 'https://api.github.com';
  var state = { posts: null, site: null, categories: null, carousel: null, sha: null };

  function getToken() {
    try { return localStorage.getItem(CONFIG.tokenKey) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { localStorage.setItem(CONFIG.tokenKey, t || ''); } catch (e) {}
  }

  /* ---------- 本地加载（站点运行时） ---------- */
  function loadLocal() {
    // 兼容两种路径：部署站点根目录 data/posts.json；设计项目 pages/ 子目录 ../data/posts.json
    var candidates = ['data/posts.json', '../data/posts.json'];
    return candidates.reduce(function (chain, p) {
      return chain.then(function (ok) {
        if (ok) return ok;
        return fetch(p, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (data) { adopt(data); return data; });
      }).catch(function () { return null; });
    }, Promise.resolve(null)).then(function (data) {
      if (!data) { throw new Error('DATA_NOT_FOUND'); }
      return data;
    });
  }

  /* ---------- 从 GitHub 加载（编辑器用，拿到最新 + sha） ---------- */
  function loadFromGithub(token) {
    var t = token || getToken();
    if (!t) { return Promise.reject(new Error('NO_TOKEN')); }
    var url = API + '/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + CONFIG.filePath + '?ref=' + CONFIG.branch;
    return fetch(url, { headers: { 'Authorization': 'token ' + t, 'Accept': 'application/vnd.github+json' } })
      .then(function (r) {
        if (r.status === 401) { throw new Error('BAD_TOKEN'); }
        if (r.status === 404) { throw new Error('NOT_FOUND'); }
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return r.json();
      })
      .then(function (meta) {
        state.sha = meta.sha;
        var raw = decodeURIComponent(escape(atob(meta.content.replace(/\n/g, ''))));
        var data = JSON.parse(raw);
        adopt(data);
        return data;
      });
  }

  /* ---------- 写入仓库（保存/发布） ---------- */
  function saveToGithub(data, token, message) {
    var t = token || getToken();
    if (!t) { return Promise.reject(new Error('NO_TOKEN')); }
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    var body = {
      message: message || '更新博客内容',
      content: content,
      branch: CONFIG.branch
    };
    if (state.sha) { body.sha = state.sha; }

    return fetch(API + '/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' + CONFIG.filePath, {
      method: 'PUT',
      headers: { 'Authorization': 'token ' + t, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) { throw new Error('BAD_TOKEN'); }
      if (!r.ok) { return r.json().then(function (j) { throw new Error((j && j.message) || 'HTTP ' + r.status); }); }
      return r.json();
    }).then(function (meta) {
      state.sha = meta.content && meta.content.sha;
      return meta;
    });
  }

  function adopt(data) {
    state.site = data.site || null;
    state.categories = data.categories || {};
    state.carousel = data.carousel || [];
    state.posts = data.posts || [];
  }

  /* ---------- 查询辅助 ---------- */
  function getPost(id) {
    var arr = state.posts || [];
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) { return arr[i]; } }
    return null;
  }
  function latest(n) {
    var arr = (state.posts || []).slice();
    return arr.slice(0, n || arr.length);
  }
  function snapshot() {
    return {
      site: state.site || { title: 'Im-chc', owner: '', bio: '', stats: {} },
      categories: state.categories || {},
      carousel: state.carousel || [],
      posts: state.posts || []
    };
  }

  /* ---------- Markdown 极简渲染（## 标题 / 段落 / 引用） ---------- */
  function renderMarkdown(md) {
    if (!md) { return ''; }
    var lines = String(md).split(/\r?\n/);
    var html = '';
    var para = [];
    function flush() {
      if (para.length) { html += '<p>' + para.join(' ') + '</p>'; para = []; }
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) { flush(); continue; }
      if (/^##\s+/.test(line)) { flush(); html += '<h2>' + escapeHtml(line.replace(/^##\s+/, '')) + '</h2>'; continue; }
      if (/^#\s+/.test(line)) { flush(); html += '<h1>' + escapeHtml(line.replace(/^#\s+/, '')) + '</h1>'; continue; }
      if (/^>\s?/.test(line)) { flush(); html += '<blockquote>' + escapeHtml(line.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
      para.push(escapeHtml(line));
    }
    flush();
    return html;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 资源路径解析（兼容设计项目 pages/ 子目录） ---------- */
  function resolveAsset(path) {
    if (!path) return path;
    var inSubdir = /\/pages\/[^/]*\.html/.test(location.pathname) || /(^|\/)pages\//.test(location.pathname);
    if (inSubdir && path.indexOf('../') !== 0) { return '../' + path.replace(/^\.\//, ''); }
    return path;
  }

  global.IM_CMS = {
    CONFIG: CONFIG,
    getToken: getToken,
    setToken: setToken,
    loadLocal: loadLocal,
    loadFromGithub: loadFromGithub,
    saveToGithub: saveToGithub,
    getPost: getPost,
    latest: latest,
    snapshot: snapshot,
    renderMarkdown: renderMarkdown,
    resolveAsset: resolveAsset,
    get sha() { return state.sha; }
  };
})(window);
