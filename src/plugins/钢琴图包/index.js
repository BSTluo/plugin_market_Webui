(function iiroseEmojiCategoriesScript() {
  'use strict';

  if (window.__iiroseEmojiCategoriesInstalled) return;
  window.__iiroseEmojiCategoriesInstalled = true;

  const STORAGE_KEY = 'iiroseEmojiCategories';
  const EXTRA_STORAGE_KEY = 'iiroseExtraEmojis';
  const ALL_CATEGORY_ID = 'all';
  const PACK_APP = 'iirose-emoji-categories';
  const PACK_VERSION = 2;
  const MARKET_APP = 'iirose-emoji-market';
  const MARKET_VERSION = 1;
  const MARKET_INDEX_URL = 'https://oss.modest6.cloud/emoji-market/index.json';
  const LONG_PRESS_MS = 520;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const FACE_HOLDER_SELECTOR = '#faceHolder';
  const CUSTOM_EMOJI_CONTENT_SELECTOR = '#faceHolder .emojiContentBox[index="4"]';
  const CUSTOM_EMOJI_BOX_SELECTOR = '#faceHolder .emojiContentBox[index="4"] .faceHolderBoxChild';
  const CUSTOM_EMOJI_PAGE_SELECTOR = '#faceHolder .emojiContentBox[index="4"] .emojiPage';

  let setupTimer = 0;
  let barSignature = '';
  let itemMenu = null;
  let categoryMenu = null;
  let categoryPickerMenu = null;
  let shareMenu = null;
  let activeDialog = null;
  let longPressTimer = 0;
  let longPressStart = null;
  let suppressedClick = null;

  installInSameOriginFrames();
  injectStyle();
  installObservers();
  installEvents();
  scheduleSetup();

  function installInSameOriginFrames() {
    const source = '(' + iiroseEmojiCategoriesScript.toString() + ')();';

    const install = (frame) => {
      try {
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;
        if (
          !frameWindow ||
          !frameDocument ||
          frameWindow.__iiroseEmojiCategoriesInstalled
        ) {
          return;
        }

        const script = frameDocument.createElement('script');
        script.textContent = source;
        (frameDocument.head || frameDocument.documentElement).appendChild(script);
        script.remove();
      } catch (error) {
        // Cross-origin iframes cannot be touched from the parent page.
      }
    };

    const scan = () => {
      document.querySelectorAll('iframe').forEach(install);
      installSyncModule();
    };

    scan();
    window.setInterval(scan, 1500);
  }

  // ---------- Sync module ----------
  function installSyncModule() {
    const win = getIIROSEWindow();
    if (!win || !win.socket || win.__iiroseEmojiSyncInstalled) return;

    win.__iiroseEmojiSyncInstalled = true;

    const originalOnMessage = win.socket._onmessage;
    win.socket._onmessage = function(msg) {
      handleSyncMessage(msg, win);

      const filteredMsg = filterSyncMessage(msg);
      if (filteredMsg === null) return;

      if (originalOnMessage) originalOnMessage.call(win.socket, filteredMsg);
    };
  }

  function getIIROSEWindow() {
    if (window.socket && window.uid) return window;

    const iframe = document.getElementById('mainFrame');
    try {
      if (iframe && iframe.contentWindow && iframe.contentWindow.socket && iframe.contentWindow.uid) {
        return iframe.contentWindow;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function handleSyncMessage(msg, win) {
    if (typeof msg !== 'string') return;

    const match = msg.match(/#~([^~|]+)(?:\|([^~]*))?~#/);
    if (!match) return;

    const command = match[1];
    const payload = match[2] || '';

    if (command === 'sync_req') {
      showSyncConfirmDialog(win);
    } else if (command === 'sync_push') {
      receiveSyncData(payload);
    }
  }

  function filterSyncMessage(msg) {
    if (typeof msg !== 'string') return msg;

    const syncPushRegex = /#~sync_push\|iiroseEmojiCategories\|(?:%7B.*?%7D)?~#/i;
    const syncReqRegex = /#~sync_req~#/i;
    if (!syncPushRegex.test(msg) && !syncReqRegex.test(msg)) return msg;

    if (msg.startsWith('""')) {
      const parts = msg.substring(2).split('<');
      const filteredParts = parts.filter((part) => !syncPushRegex.test(part) && !syncReqRegex.test(part));
      if (!filteredParts.length) return null;
      return '""' + filteredParts.join('<');
    }

    return null;
  }

  function requestSync(button) {
    const win = getIIROSEWindow();
    if (!win || !win.socket || !win.uid) {
      showSyncToast('未找到 WebSocket 连接，无法请求同步。', true);
      return;
    }

    win.socket.send(JSON.stringify({
      g: win.uid,
      m: '#~sync_req~#',
      mc: win.inputcolorhex || '#ff9800',
      i: createSyncMessageId(),
    }));

    if (button) {
      const oldText = button.textContent;
      button.textContent = '已发';
      button.classList.add('iirose-emoji-category-button--sent');
      window.setTimeout(() => {
        button.textContent = oldText;
        button.classList.remove('iirose-emoji-category-button--sent');
      }, 1800);
    } else {
      showSyncToast('已发送同步请求。');
    }
  }

  function showSyncConfirmDialog(win) {
    showConfirmDialog({
      title: '同步请求',
      message: '收到表情分类同步请求，是否发送本机分类数据？',
      confirmText: '发送',
      onConfirm: () => sendSyncData(win),
    });
  }

  function sendSyncData(win) {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      raw = null;
    }

    if (!raw) {
      showSyncToast('本地没有表情分类数据。', true);
      return;
    }

    win.socket.send(JSON.stringify({
      g: win.uid,
      m: '#~sync_push|' + STORAGE_KEY + '|' + encodeURIComponent(raw) + '~#',
      mc: win.inputcolorhex || '#2196f3',
      i: createSyncMessageId(),
    }));

    showSyncToast('已发送本机表情分类数据。');
  }

  function receiveSyncData(payload) {
    const separatorIndex = payload.indexOf('|');
    if (separatorIndex === -1) return;

    const key = payload.slice(0, separatorIndex);
    if (key !== STORAGE_KEY) return;

    const encoded = payload.slice(separatorIndex + 1);
    let parsed = null;
    try {
      parsed = JSON.parse(decodeURIComponent(encoded));
    } catch (error) {
      showSyncToast('同步数据解析失败。', true);
      return;
    }

    // 复用导入的清洗逻辑：URL 规范化 + 仅保留 http(s) + 去重；丢弃 id 由本端重新生成。
    const categories = extractImportedCategories(parsed);
    if (!categories.length) {
      showSyncToast('同步数据里没有可用的分类。', true);
      return;
    }

    showSyncApplyDialog(categories);
  }

  // 收到同步数据后，覆盖前让用户在「合并 / 覆盖 / 取消」之间选择，避免静默覆盖丢数据。
  function showSyncApplyDialog(categories) {
    closeDialog();

    const dialog = createDialogShell({
      title: '收到分类同步',
      confirmText: '覆盖本地',
      danger: true,
    });

    const hint = document.createElement('div');
    hint.className = 'iirose-emoji-import-hint';
    hint.textContent = '收到 ' + categories.length + ' 个分类。合并会保留本地已有分类，覆盖会替换本地全部分类。';
    dialog.content.appendChild(hint);

    const mergeButton = document.createElement('button');
    mergeButton.type = 'button';
    mergeButton.className = 'iirose-emoji-export-row';
    mergeButton.textContent = '合并到本地（推荐）';
    dialog.content.appendChild(mergeButton);

    const applyAndClose = (mode) => {
      const result = applyImportedCategories(categories, mode);
      closeDialog();
      barSignature = '';
      scheduleSetup();
      renderCategoryBar();
      applyCategoryFilter();
      showSyncToast(result.message);
    };

    mergeButton.addEventListener('click', () => applyAndClose('merge'));
    dialog.confirmButton.addEventListener('click', () => applyAndClose('overwrite'));
  }

  function createSyncMessageId() {
    return Date.now().toString().slice(-5) + Math.random().toString().slice(-7);
  }

  function showSyncToast(message, danger) {
    const old = document.querySelector('.iirose-emoji-sync-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = 'iirose-emoji-sync-toast';
    toast.classList.toggle('iirose-emoji-sync-toast--danger', Boolean(danger));
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 2600);
  }
  // ---------- Sync module end ----------

  function installObservers() {
    const observer = new MutationObserver(scheduleSetup);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
  }

  function installEvents() {
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('contextmenu', handleCategoryContextMenu, true);
    document.addEventListener('contextmenu', handleCustomEmojiContextMenu, true);
    document.addEventListener('pointerdown', handleCategoryPointerDown, true);
    document.addEventListener('pointerdown', handleCustomEmojiPointerDown, true);
    document.addEventListener('pointermove', handleCustomEmojiPointerMove, true);
    document.addEventListener('pointerup', cancelLongPress, true);
    document.addEventListener('pointercancel', cancelLongPress, true);
    window.addEventListener('resize', positionFloatingPanels, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', positionFloatingPanels, true);
      window.visualViewport.addEventListener('scroll', positionFloatingPanels, true);
    }
  }

  function scheduleSetup() {
    window.clearTimeout(setupTimer);
    setupTimer = window.setTimeout(setup, 80);
  }

  function setup() {
    const faceHolder = document.querySelector(FACE_HOLDER_SELECTOR);
    const emojiPage = document.querySelector(CUSTOM_EMOJI_PAGE_SELECTOR);
    if (!faceHolder || !emojiPage) {
      closeItemMenu();
      closeCategoryMenu();
      closeCategoryPickerMenu();
      closeShareMenu();
      return;
    }

    faceHolder.classList.add('iirose-emoji-category-holder');
    cleanupLegacyTopLevelBar(faceHolder);
    const bar = ensureCategoryBar(emojiPage);
    const active = isCustomEmojiPanelActive();
    faceHolder.classList.toggle('iirose-emoji-category-active', active);
    bar.hidden = !active;

    if (!active) {
      closeItemMenu();
      closeCategoryMenu();
      closeCategoryPickerMenu();
      closeShareMenu();
      return;
    }

    // 不再自动清除分类中本机暂未拥有的表情，保留导入包的完整 URL；
    // 失效表情的清理改为后续手动操作（pruneCategories 仍保留备用）。
    syncExtraEmojiItems();
    renderCategoryBar();
    applyCategoryFilter();
  }

  function cleanupLegacyTopLevelBar(faceHolder) {
    Array.from(faceHolder.children).forEach((child) => {
      if (child.classList && child.classList.contains('iirose-emoji-category-bar')) {
        child.remove();
      }
    });

    const typeBar = faceHolder.querySelector(':scope > .faceHolderType');
    if (typeBar && typeBar.nextElementSibling) {
      typeBar.nextElementSibling.classList.remove('iirose-emoji-category-content-wrap');
    }
  }

  function ensureCategoryBar(emojiPage) {
    const existing = emojiPage.querySelector('.iirose-emoji-category-bar');
    if (existing) return existing;

    const bar = document.createElement('div');
    bar.className = 'iirose-emoji-category-bar';
    bar.dataset.iiroseEmojiCategoryBar = '1';
    bar.hidden = true;
    emojiPage.appendChild(bar);
    return bar;
  }

  function renderCategoryBar() {
    const bar = document.querySelector(CUSTOM_EMOJI_PAGE_SELECTOR + ' .iirose-emoji-category-bar');
    if (!bar) return;

    const state = loadState();
    const signature = JSON.stringify({
      uiVersion: 2,
      activeCategoryId: state.activeCategoryId,
      categories: state.categories.map((category) => ({
        id: category.id,
        name: category.name,
      })),
    });

    if (barSignature === signature && bar.children.length) return;
    barSignature = signature;
    bar.textContent = '';

    const actions = document.createElement('div');
    actions.className = 'iirose-emoji-category-actions';
    bar.appendChild(actions);

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'iirose-emoji-category-button iirose-emoji-category-button--more';
    moreButton.dataset.emojiCategoryAction = 'more';
    moreButton.textContent = '更多';
    moreButton.title = '选择分类';
    actions.appendChild(moreButton);

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'iirose-emoji-category-button iirose-emoji-category-button--share';
    shareButton.dataset.emojiCategoryAction = 'share';
    shareButton.textContent = '分享';
    shareButton.title = '同步、导出或导入分类数据';
    actions.appendChild(shareButton);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'iirose-emoji-category-button iirose-emoji-category-button--add';
    addButton.dataset.emojiCategoryAction = 'add';
    addButton.textContent = '+';
    addButton.title = '新增分类';
    actions.appendChild(addButton);

    const scroller = document.createElement('div');
    scroller.className = 'iirose-emoji-category-scroll';
    bar.appendChild(scroller);

    scroller.appendChild(createCategoryButton('全部', ALL_CATEGORY_ID, state.activeCategoryId === ALL_CATEGORY_ID));

    state.categories.forEach((category) => {
      scroller.appendChild(createCategoryButton(category.name, category.id, state.activeCategoryId === category.id));
    });
  }

  function createCategoryButton(text, id, active) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'iirose-emoji-category-button';
    button.dataset.emojiCategoryId = id;
    button.textContent = text;
    button.title = id === ALL_CATEGORY_ID ? text : text + '，右键或长按管理';
    button.classList.toggle('iirose-emoji-category-button--active', active);
    return button;
  }

  function handleDocumentClick(event) {
    if (handleSuppressedClick(event)) return;
    if (handleShareMenuClick(event)) return;
    if (handleCategoryMenuClick(event)) return;
    if (handleCategoryPickerMenuClick(event)) return;
    if (handleItemMenuClick(event)) return;
    if (handleCategoryBarClick(event)) return;

    if (categoryMenu && !categoryMenu.contains(event.target)) {
      closeCategoryMenu();
    }

    if (categoryPickerMenu && !categoryPickerMenu.contains(event.target)) {
      closeCategoryPickerMenu();
    }

    if (shareMenu && !shareMenu.contains(event.target)) {
      closeShareMenu();
    }

    if (itemMenu && !itemMenu.contains(event.target)) {
      closeItemMenu();
    }
  }

  function handleSuppressedClick(event) {
    if (!suppressedClick || Date.now() > suppressedClick.until) {
      suppressedClick = null;
      return false;
    }

    if (suppressedClick.type === 'emoji') {
      const item = findCustomEmojiItem(event.target);
      if (!item || item !== suppressedClick.item) return false;
    } else if (suppressedClick.type === 'category') {
      const button = findCategoryButton(event.target);
      if (!button || button !== suppressedClick.button) return false;
    } else {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    suppressedClick = null;
    return true;
  }

  function handleCategoryBarClick(event) {
    const button = event.target.closest && event.target.closest('.iirose-emoji-category-bar button');
    if (!button) return false;

    event.preventDefault();
    event.stopPropagation();

    if (button.dataset.emojiCategoryAction === 'add') {
      createCategoryFromPrompt();
      return true;
    }

    if (button.dataset.emojiCategoryAction === 'more') {
      showCategoryPickerMenu(button);
      return true;
    }

    if (button.dataset.emojiCategoryAction === 'share') {
      showShareMenu();
      return true;
    }

    const categoryId = button.dataset.emojiCategoryId;
    if (!categoryId) return true;

    const state = loadState();
    state.activeCategoryId = hasCategory(state, categoryId) ? categoryId : ALL_CATEGORY_ID;
    saveState(state);
    renderCategoryBar();
    applyCategoryFilter();
    return true;
  }

  function handleCategoryMenuClick(event) {
    if (!categoryMenu) return false;

    const button = event.target.closest && event.target.closest('.iirose-emoji-category-menu button');
    if (!button) return categoryMenu.contains(event.target);

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.categoryMenuAction;
    const categoryId = categoryMenu.dataset.categoryId;

    if (action === 'export') {
      closeCategoryMenu();
      showExportTextDialog(categoryId);
      return true;
    }

    if (action === 'delete') {
      const state = loadState();
      const category = state.categories.find((item) => item.id === categoryId);
      closeCategoryMenu();
      if (category) {
        showConfirmDialog({
          title: '删除分类',
          message: '确定删除“' + category.name + '”？分类内的表情不会从图包中删除。',
          confirmText: '删除',
          danger: true,
          onConfirm: () => deleteCategory(category.id),
        });
      }
      return true;
    }

    return true;
  }

  function handleShareMenuClick(event) {
    if (!shareMenu) return false;

    const button = event.target.closest && event.target.closest('.iirose-emoji-share-menu button');
    if (!button) return shareMenu.contains(event.target);

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.shareMenuAction;
    closeShareMenu();

    if (action === 'sync') {
      requestSync();
      return true;
    }

    if (action === 'market') {
      showMarketDialog();
      return true;
    }

    if (action === 'export') {
      showExportPickerDialog();
      return true;
    }

    if (action === 'import') {
      showImportTextDialog();
      return true;
    }

    return true;
  }

  function handleCategoryPickerMenuClick(event) {
    if (!categoryPickerMenu) return false;

    const button = event.target.closest && event.target.closest('.iirose-emoji-category-picker button');
    if (!button) return categoryPickerMenu.contains(event.target);

    event.preventDefault();
    event.stopPropagation();

    const categoryId = button.dataset.emojiCategoryId;
    if (categoryId) {
      const state = loadState();
      state.activeCategoryId = hasCategory(state, categoryId) ? categoryId : ALL_CATEGORY_ID;
      saveState(state);
      closeCategoryPickerMenu();
      renderCategoryBar();
      applyCategoryFilter();
    }

    return true;
  }

  function handleItemMenuClick(event) {
    if (!itemMenu) return false;

    const button = event.target.closest && event.target.closest('.iirose-emoji-category-menu button');
    if (!button) return itemMenu.contains(event.target);

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.emojiMenuAction;
    const url = itemMenu.dataset.emojiUrl;
    if (!url) {
      closeItemMenu();
      return true;
    }

    if (action === 'new') {
      createCategoryFromPrompt(url);
      closeItemMenu();
      return true;
    }

    if (action === 'toggle') {
      toggleEmojiInCategory(button.dataset.categoryId, url);
      closeItemMenu();
      return true;
    }

    if (action === 'remove-current') {
      const state = loadState();
      removeEmojiFromCategory(state.activeCategoryId, url);
      closeItemMenu();
      return true;
    }

    return true;
  }

  function handleCategoryContextMenu(event) {
    const button = findCategoryButton(event.target);
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    showCategoryMenu(button, event.clientX, event.clientY);
  }

  function handleCustomEmojiContextMenu(event) {
    const item = findCustomEmojiItem(event.target);
    if (!item) return;

    event.preventDefault();
    event.stopPropagation();
    showItemMenu(item, event.clientX, event.clientY);
  }

  function handleCategoryPointerDown(event) {
    if (event.pointerType === 'mouse') return;

    const button = findCategoryButton(event.target);
    if (!button) return;

    cancelLongPress();
    longPressStart = {
      type: 'category',
      button,
      x: event.clientX,
      y: event.clientY,
    };

    longPressTimer = window.setTimeout(() => {
      suppressedClick = {
        type: 'category',
        button,
        until: Date.now() + 900,
      };
      showCategoryMenu(button, event.clientX, event.clientY);
      cancelLongPressTimerOnly();
    }, LONG_PRESS_MS);
  }

  function handleCustomEmojiPointerDown(event) {
    if (event.pointerType === 'mouse') return;

    const item = findCustomEmojiItem(event.target);
    if (!item) return;

    cancelLongPress();
    longPressStart = {
      type: 'emoji',
      item,
      x: event.clientX,
      y: event.clientY,
    };

    longPressTimer = window.setTimeout(() => {
      suppressedClick = {
        type: 'emoji',
        item,
        until: Date.now() + 900,
      };
      showItemMenu(item, event.clientX, event.clientY);
      cancelLongPressTimerOnly();
    }, LONG_PRESS_MS);
  }

  function handleCustomEmojiPointerMove(event) {
    if (!longPressStart) return;

    const dx = Math.abs(event.clientX - longPressStart.x);
    const dy = Math.abs(event.clientY - longPressStart.y);
    if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
      cancelLongPress();
    }
  }

  function cancelLongPress() {
    cancelLongPressTimerOnly();
    longPressStart = null;
  }

  function cancelLongPressTimerOnly() {
    window.clearTimeout(longPressTimer);
    longPressTimer = 0;
  }

  function showItemMenu(item, x, y) {
    const url = getEmojiItemUrl(item);
    if (!url) return;

    closeCategoryMenu();
    closeItemMenu();
    closeShareMenu();

    const state = loadState();
    const menu = document.createElement('div');
    menu.className = 'iirose-emoji-category-menu';
    menu.dataset.emojiUrl = url;

    const title = document.createElement('div');
    title.className = 'iirose-emoji-category-menu-title';
    title.textContent = '表情分类';
    menu.appendChild(title);

    if (state.categories.length) {
      state.categories.forEach((category) => {
        const button = document.createElement('button');
        const included = category.items.includes(url);
        button.type = 'button';
        button.className = 'iirose-emoji-category-menu-button';
        button.dataset.emojiMenuAction = 'toggle';
        button.dataset.categoryId = category.id;
        button.textContent = (included ? '✓ ' : '+ ') + category.name;
        menu.appendChild(button);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'iirose-emoji-category-menu-empty';
      empty.textContent = '还没有分类';
      menu.appendChild(empty);
    }

    if (state.activeCategoryId !== ALL_CATEGORY_ID && categoryContainsEmoji(state, state.activeCategoryId, url)) {
      const removeCurrentButton = document.createElement('button');
      removeCurrentButton.type = 'button';
      removeCurrentButton.className = 'iirose-emoji-category-menu-button';
      removeCurrentButton.dataset.emojiMenuAction = 'remove-current';
      removeCurrentButton.textContent = '从当前分类移除';
      menu.appendChild(removeCurrentButton);
    }

    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'iirose-emoji-category-menu-button iirose-emoji-category-menu-button--primary';
    newButton.dataset.emojiMenuAction = 'new';
    newButton.textContent = '新建分类并加入';
    menu.appendChild(newButton);

    document.body.appendChild(menu);
    itemMenu = menu;
    positionItemMenu(menu, x, y);
  }

  function showCategoryMenu(button, x, y) {
    const categoryId = button.dataset.emojiCategoryId;
    const state = loadState();
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category) return;

    closeItemMenu();
    closeCategoryMenu();
    closeShareMenu();

    const menu = document.createElement('div');
    menu.className = 'iirose-emoji-category-menu';
    menu.dataset.categoryId = category.id;

    const title = document.createElement('div');
    title.className = 'iirose-emoji-category-menu-title';
    title.textContent = category.name;
    menu.appendChild(title);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'iirose-emoji-category-menu-button';
    exportButton.dataset.categoryMenuAction = 'export';
    exportButton.textContent = '导出分类';
    menu.appendChild(exportButton);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'iirose-emoji-category-menu-button iirose-emoji-category-menu-button--danger';
    deleteButton.dataset.categoryMenuAction = 'delete';
    deleteButton.textContent = '删除分类';
    menu.appendChild(deleteButton);

    document.body.appendChild(menu);
    categoryMenu = menu;
    positionItemMenu(menu, x, y);
  }

  function showCategoryPickerMenu(anchorButton) {
    const state = loadState();

    closeItemMenu();
    closeCategoryMenu();
    closeCategoryPickerMenu();
    closeShareMenu();

    const menu = document.createElement('div');
    menu.className = 'iirose-emoji-category-menu iirose-emoji-category-picker';

    const title = document.createElement('div');
    title.className = 'iirose-emoji-category-menu-title';
    title.textContent = '选择分类';
    menu.appendChild(title);

    menu.appendChild(createCategoryPickerButton('全部', ALL_CATEGORY_ID, state.activeCategoryId === ALL_CATEGORY_ID));

    state.categories.forEach((category) => {
      menu.appendChild(createCategoryPickerButton(category.name, category.id, state.activeCategoryId === category.id));
    });

    document.body.appendChild(menu);
    categoryPickerMenu = menu;
    positionCategoryPickerMenu(menu, anchorButton);
  }

  function showShareMenu() {
    closeItemMenu();
    closeCategoryMenu();
    closeCategoryPickerMenu();
    closeShareMenu();

    const root = document.createElement('div');
    root.className = 'iirose-emoji-share-menu';

    const panel = document.createElement('div');
    panel.className = 'iirose-emoji-share-menu-panel';
    root.appendChild(panel);

    const header = document.createElement('div');
    header.className = 'iirose-emoji-share-menu-header';
    header.textContent = '分类与市场';
    panel.appendChild(header);

    panel.appendChild(createShareMenuButton('表情市场', 'market', 'mdi-store'));
    panel.appendChild(createShareMenuButton('同步', 'sync', 'mdi-sync'));
    panel.appendChild(createShareMenuButton('导出分类', 'export', 'mdi-content-copy'));
    panel.appendChild(createShareMenuButton('导入分类', 'import', 'mdi-card-text-outline'));

    root.addEventListener('click', (event) => {
      if (event.target === root) closeShareMenu();
    });

    document.body.appendChild(root);
    shareMenu = root;
    positionShareMenu(root);
    window.setTimeout(() => positionShareMenu(root), 80);
  }

  function createShareMenuButton(text, action, iconClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'iirose-emoji-share-menu-item';
    button.dataset.shareMenuAction = action;

    const icon = document.createElement('span');
    icon.className = 'iirose-emoji-share-menu-icon ' + iconClass;
    button.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'iirose-emoji-share-menu-label';
    label.textContent = text;
    button.appendChild(label);

    return button;
  }

  function createCategoryPickerButton(text, id, active) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'iirose-emoji-category-menu-button';
    button.dataset.emojiCategoryId = id;
    button.textContent = (active ? '✓ ' : '') + text;
    button.classList.toggle('iirose-emoji-category-menu-button--active', active);
    return button;
  }

  function positionCategoryPickerMenu(menu, anchorButton) {
    const anchorRect = anchorButton.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const padding = 8;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const left = clamp(anchorRect.right - rect.width, padding, viewportWidth - rect.width - padding);
    const top = clamp(anchorRect.top - rect.height - 8, padding, viewportHeight - rect.height - padding);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function positionItemMenu(menu, x, y) {
    const padding = 8;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const left = clamp(x, padding, viewportWidth - rect.width - padding);
    const top = clamp(y, padding, viewportHeight - rect.height - padding);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function closeItemMenu() {
    if (!itemMenu) return;
    itemMenu.remove();
    itemMenu = null;
  }

  function closeCategoryMenu() {
    if (!categoryMenu) return;
    categoryMenu.remove();
    categoryMenu = null;
  }

  function closeCategoryPickerMenu() {
    if (!categoryPickerMenu) return;
    categoryPickerMenu.remove();
    categoryPickerMenu = null;
  }

  function closeShareMenu() {
    if (!shareMenu) return;
    shareMenu.remove();
    shareMenu = null;
  }

  function createCategoryFromPrompt(initialEmojiUrl) {
    closeItemMenu();
    closeCategoryMenu();
    closeShareMenu();

    showTextDialog({
      title: '新建分类',
      placeholder: '请输入分类名称 . . .',
      confirmText: '确定',
      onConfirm: (name) => createCategory(name, initialEmojiUrl),
    });
  }

  function createCategory(rawName, initialEmojiUrl) {
    const name = rawName && rawName.trim();
    if (!name) return null;

    const state = loadState();
    const previousActiveCategoryId = state.activeCategoryId;
    const existing = state.categories.find((category) => category.name === name);
    if (existing) {
      if (initialEmojiUrl && !existing.items.includes(initialEmojiUrl)) {
        existing.items.push(initialEmojiUrl);
      }
      state.activeCategoryId = initialEmojiUrl ? existing.id : previousActiveCategoryId;
      saveState(state);
      renderCategoryBar();
      applyCategoryFilter();
      return existing;
    }

    const category = {
      id: 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      name: name.slice(0, 18),
      items: initialEmojiUrl ? [initialEmojiUrl] : [],
    };

    state.categories.push(category);
    state.activeCategoryId = initialEmojiUrl ? category.id : previousActiveCategoryId;
    saveState(state);
    renderCategoryBar();
    applyCategoryFilter();
    return category;
  }

  function deleteCategory(categoryId) {
    const state = loadState();
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category) return;

    state.categories = state.categories.filter((item) => item.id !== categoryId);
    if (state.activeCategoryId === categoryId) {
      state.activeCategoryId = ALL_CATEGORY_ID;
    }

    saveState(state);
    cleanupExtraEmojiState(state);
    syncExtraEmojiItems();
    renderCategoryBar();
    applyCategoryFilter();
  }

  function showExportTextDialog(categoryId) {
    const text = createExportText(categoryId);
    if (!text) {
      showSyncToast('没有可导出的分类。', true);
      return;
    }

    showTextareaDialog({
      title: categoryId ? '导出分类' : '导出全部',
      value: text,
      readOnly: true,
      confirmText: '复制',
      onConfirm: (value, textarea) => copyTextToClipboard(value, textarea),
    });
  }

  function showExportPickerDialog() {
    const state = loadState();

    closeItemMenu();
    closeCategoryMenu();
    closeCategoryPickerMenu();
    closeShareMenu();

    const dialog = createDialogShell({
      title: '导出分类',
      confirmText: '导出全部',
    });

    if (!state.categories.length) {
      const empty = document.createElement('div');
      empty.className = 'iirose-emoji-dialog-message';
      empty.textContent = '还没有分类可以导出。';
      dialog.content.appendChild(empty);
      dialog.confirmButton.addEventListener('click', () => closeDialog());
      return;
    }

    const hint = document.createElement('div');
    hint.className = 'iirose-emoji-import-hint';
    hint.textContent = '点击某个分类单独导出，或点底部“导出全部”。';
    dialog.content.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'iirose-emoji-import-list';
    state.categories.forEach((category) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'iirose-emoji-export-row';
      row.dataset.categoryId = category.id;
      row.textContent = category.name + '（' + category.items.length + ' 个表情）';
      list.appendChild(row);
    });
    dialog.content.appendChild(list);

    list.addEventListener('click', (event) => {
      const row = event.target.closest('.iirose-emoji-export-row');
      if (!row) return;
      closeDialog();
      showExportTextDialog(row.dataset.categoryId);
    });

    dialog.confirmButton.addEventListener('click', () => {
      closeDialog();
      showExportTextDialog(null);
    });
  }

  function showImportTextDialog() {
    showTextareaDialog({
      title: '导入分类',
      placeholder: '粘贴分类分享文本 . . .',
      confirmText: '下一步',
      onConfirm: (value, textarea, dialog) => {
        const result = readImportText(value);
        if (!result.ok) {
          textarea.focus();
          dialog.root.classList.add('iirose-emoji-dialog--shake');
          window.setTimeout(() => dialog.root.classList.remove('iirose-emoji-dialog--shake'), 220);
          showSyncToast(result.message, true);
          return false;
        }

        closeDialog();
        showImportSelectDialog(result.categories);
        return true;
      },
    });
  }

  function showImportSelectDialog(categories) {
    closeDialog();

    const dialog = createDialogShell({
      title: '选择要导入的分类',
      confirmText: '导入',
    });

    const hint = document.createElement('div');
    hint.className = 'iirose-emoji-import-hint';
    hint.textContent = '勾选要导入的分类，同名分类会自动合并。';
    dialog.content.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'iirose-emoji-import-list';
    categories.forEach((category, index) => {
      const row = document.createElement('label');
      row.className = 'iirose-emoji-import-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'iirose-emoji-import-checkbox';
      checkbox.checked = true;
      checkbox.dataset.index = String(index);
      row.appendChild(checkbox);

      const text = document.createElement('span');
      text.className = 'iirose-emoji-import-row-text';
      text.textContent = category.name + '（' + category.items.length + ' 个表情）';
      row.appendChild(text);

      list.appendChild(row);
    });
    dialog.content.appendChild(list);

    dialog.confirmButton.addEventListener('click', () => {
      const selected = Array.from(list.querySelectorAll('.iirose-emoji-import-checkbox'))
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => categories[Number(checkbox.dataset.index)])
        .filter(Boolean);

      if (!selected.length) {
        dialog.root.classList.add('iirose-emoji-dialog--shake');
        window.setTimeout(() => dialog.root.classList.remove('iirose-emoji-dialog--shake'), 220);
        showSyncToast('请至少选择一个分类。', true);
        return;
      }

      const result = applyImportedCategories(selected, 'merge');
      closeDialog();
      barSignature = '';
      renderCategoryBar();
      applyCategoryFilter();
      showSyncToast(result.message);
    });
  }

  function createExportText(categoryId) {
    const state = loadState();

    if (categoryId) {
      const category = state.categories.find((item) => item.id === categoryId);
      if (!category) return '';
      return JSON.stringify(buildCategoryPack(category), null, 2);
    }

    return JSON.stringify(buildCategoriesBundle(state.categories), null, 2);
  }

  function buildCategoryPack(category) {
    const items = category.items.slice();
    return {
      app: PACK_APP,
      format: 'pack',
      version: PACK_VERSION,
      exportedAt: new Date().toISOString(),
      pack: {
        name: category.name,
        count: items.length,
        cover: items[0] || '',
        items,
      },
    };
  }

  function buildCategoriesBundle(categories) {
    return {
      app: PACK_APP,
      format: 'bundle',
      version: PACK_VERSION,
      exportedAt: new Date().toISOString(),
      packs: categories.map((category) => {
        const items = category.items.slice();
        return {
          name: category.name,
          count: items.length,
          cover: items[0] || '',
          items,
        };
      }),
    };
  }

  function readImportText(text) {
    const raw = String(text || '').trim();
    if (!raw) {
      return {
        ok: false,
        message: '导入文本不能为空。',
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        message: '导入文本不是有效 JSON。',
      };
    }

    const categories = extractImportedCategories(parsed);
    if (!categories.length) {
      return {
        ok: false,
        message: '没有找到可导入的分类。',
      };
    }

    return {
      ok: true,
      categories,
    };
  }

  function extractImportedCategories(parsed) {
    if (parsed && typeof parsed === 'object' && parsed.format === 'pack') {
      const pack = sanitizeRemotePack(parsed);
      return pack ? [pack] : [];
    }

    const sourceCategories = parsed && parsed.pack && typeof parsed.pack === 'object'
      ? [parsed.pack]
      : parsed && Array.isArray(parsed.packs)
        ? parsed.packs
        : parsed && parsed.payload && Array.isArray(parsed.payload.categories)
          ? parsed.payload.categories
          : parsed && Array.isArray(parsed.categories)
            ? parsed.categories
            : [];

    return sourceCategories.map(sanitizeImportedCategory).filter(Boolean);
  }

  function sanitizeRemotePack(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.app && parsed.app !== PACK_APP) return null;
    if (parsed.format !== 'pack') return null;
    return sanitizeImportedCategory(parsed.pack);
  }

  function sanitizeImportedCategory(category) {
    if (!category || typeof category !== 'object') return null;

    const name = String(category.name || '').trim().slice(0, 18);
    if (!name) return null;

    const seen = new Set();
    const items = (Array.isArray(category.items) ? category.items : [])
      .map(normalizeEmojiUrl)
      .filter((url) => isSafeEmojiUrl(url))
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });

    return {
      name,
      items,
    };
  }

  // 统一的导入/同步落地路径：分类导入、市场导入、跨端同步都走这里，
  // 保证「分类映射」和「额外表情」两份数据始终一起更新。
  // mode = 'merge'（默认，同名分类合并）| 'overwrite'（整体替换本地分类）。
  function applyImportedCategories(categories, mode) {
    const overwrite = mode === 'overwrite';
    const state = loadState();
    const extra = loadExtraEmojiState();
    let createdCount = 0;
    let mergedCount = 0;
    let addedItemCount = 0;
    let addedExtraCount = 0;

    if (overwrite) {
      state.categories = [];
      state.activeCategoryId = ALL_CATEGORY_ID;
      extra.items = [];
    }

    categories.forEach((category) => {
      category.items.forEach((url) => {
        if (!extra.items.includes(url)) {
          extra.items.push(url);
          addedExtraCount += 1;
        }
      });

      const existing = overwrite
        ? null
        : state.categories.find((item) => item.name === category.name);
      if (existing) {
        mergedCount += 1;
        category.items.forEach((url) => {
          if (!existing.items.includes(url)) {
            existing.items.push(url);
            addedItemCount += 1;
          }
        });
      } else {
        state.categories.push({
          id: createCategoryId(),
          name: category.name,
          items: category.items.slice(),
        });
        createdCount += 1;
        addedItemCount += category.items.length;
      }
    });

    saveState(state);
    saveExtraEmojiState(extra);
    // 去掉额外表情里已属于官方图包或不再被任何分类引用的 URL。
    cleanupExtraEmojiState(state);
    syncExtraEmojiItems();

    return {
      ok: true,
      message: (overwrite ? '覆盖完成：' : '导入完成：') + '新增 ' + createdCount + ' 个分类，合并 ' + mergedCount + ' 个分类，加入 ' + addedItemCount + ' 个表情，新增 ' + addedExtraCount + ' 个额外表情。',
    };
  }

  function showMarketDialog() {
    closeItemMenu();
    closeCategoryMenu();
    closeCategoryPickerMenu();
    closeShareMenu();
    closeDialog();

    const dialog = createDialogShell({
      title: '表情市场',
      confirmText: '关闭',
      rootClass: 'iirose-emoji-dialog--market',
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'iirose-emoji-market-toolbar';
    dialog.content.appendChild(toolbar);

    const status = document.createElement('div');
    status.className = 'iirose-emoji-market-status';
    status.textContent = '正在读取市场目录...';
    toolbar.appendChild(status);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'iirose-emoji-market-refresh';
    refreshButton.textContent = '刷新';
    toolbar.appendChild(refreshButton);

    const list = document.createElement('div');
    list.className = 'iirose-emoji-market-list';
    dialog.content.appendChild(list);

    const load = () => loadMarketIndexInto(list, status, refreshButton);
    refreshButton.addEventListener('click', load);
    dialog.confirmButton.addEventListener('click', () => closeDialog());
    load();
  }

  function loadMarketIndexInto(list, status, refreshButton) {
    if (refreshButton) refreshButton.disabled = true;
    if (list) list.innerHTML = '';
    if (status) status.textContent = '正在读取市场目录...';

    fetchMarketIndex()
      .then((market) => {
        renderMarketPackList(list, market.packs, status);
      })
      .catch((error) => {
        if (status) status.textContent = error && error.message ? error.message : '读取市场目录失败。';

        if (list) {
          const empty = document.createElement('div');
          empty.className = 'iirose-emoji-market-empty';
          empty.textContent = '暂时无法读取市场目录。';
          list.appendChild(empty);
        }
      })
      .finally(() => {
        if (refreshButton) refreshButton.disabled = false;
      });
  }

  function fetchMarketIndex() {
    return fetchJson(MARKET_INDEX_URL)
      .then((parsed) => sanitizeMarketIndex(parsed));
  }

  function fetchJson(url) {
    return fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    }).then((response) => {
      if (!response.ok) {
        throw new Error('请求失败：' + response.status);
      }
      return response.json();
    });
  }

  function sanitizeMarketIndex(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('市场目录格式无效。');
    }

    if (parsed.app && parsed.app !== MARKET_APP) {
      throw new Error('市场目录标识不匹配。');
    }

    const packs = Array.isArray(parsed.packs)
      ? parsed.packs.map(sanitizeMarketPackSummary).filter(Boolean)
      : [];

    return {
      version: Number(parsed.version) || MARKET_VERSION,
      updatedAt: String(parsed.updatedAt || '').trim(),
      packs,
    };
  }

  function sanitizeMarketPackSummary(pack) {
    if (!pack || typeof pack !== 'object') return null;

    const id = String(pack.id || '').trim();
    const name = String(pack.name || '').trim().slice(0, 18);
    const authorName = String(pack.authorName || '').trim().slice(0, 24);
    const authorAvatar = sanitizeHttpUrl(pack.authorAvatar);
    // 作者 uid 用于点击跳转 iirose 主页；只接受字母数字，避免内联 onclick 注入。
    const rawAuthorUid = String(pack.authorUid || '').trim();
    const authorUid = /^[A-Za-z0-9]+$/.test(rawAuthorUid) ? rawAuthorUid : '';
    const desc = String(pack.desc || '').trim().slice(0, 120);
    const tags = Array.isArray(pack.tags)
      ? pack.tags
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 8)
      : [];
    const cover = sanitizeHttpUrl(pack.cover);
    const url = sanitizeHttpUrl(pack.url);
    const count = Math.max(0, Number(pack.count) || 0);

    if (!id || !name || !url) return null;

    return {
      id,
      name,
      authorName,
      authorAvatar,
      authorUid,
      desc,
      tags,
      cover,
      count,
      url,
    };
  }

  function sanitizeHttpUrl(url) {
    const value = String(url || '').trim();
    return /^https?:\/\//i.test(value) ? value : '';
  }

  function renderMarketPackList(list, packs, status) {
    if (!list) return;
    list.innerHTML = '';

    if (!packs.length) {
      if (status) status.textContent = '市场目录为空。';
      const empty = document.createElement('div');
      empty.className = 'iirose-emoji-market-empty';
      empty.textContent = '还没有可导入的表情包。';
      list.appendChild(empty);
      return;
    }

    if (status) status.textContent = '已加载 ' + packs.length + ' 个表情包。';
    packs.forEach((pack) => {
      list.appendChild(createMarketPackCard(pack, status));
    });
  }

  function createMarketPackCard(pack, status) {
    const card = document.createElement('div');
    card.className = 'iirose-emoji-market-card';

    const cover = document.createElement('img');
    cover.className = 'iirose-emoji-market-cover';
    cover.alt = pack.name;
    cover.loading = 'lazy';
    cover.decoding = 'async';
    if (pack.cover) {
      cover.src = pack.cover;
    } else {
      cover.dataset.empty = '1';
    }
    card.appendChild(cover);

    const body = document.createElement('div');
    body.className = 'iirose-emoji-market-body';
    card.appendChild(body);

    const author = document.createElement('div');
    author.className = 'iirose-emoji-market-author';
    body.appendChild(author);

    const avatar = document.createElement('img');
    avatar.className = 'iirose-emoji-market-avatar';
    avatar.alt = pack.authorName || '作者';
    avatar.loading = 'lazy';
    avatar.decoding = 'async';
    if (pack.authorAvatar) {
      avatar.src = pack.authorAvatar;
    } else {
      avatar.dataset.empty = '1';
    }
    author.appendChild(avatar);

    const authorText = document.createElement('div');
    authorText.className = 'iirose-emoji-market-author-text';
    body.appendChild(authorText);

    const title = document.createElement('div');
    title.className = 'iirose-emoji-market-title';
    title.textContent = pack.name;
    authorText.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'iirose-emoji-market-meta';
    meta.textContent = (pack.authorName || '未知作者') + ' · ' + pack.count + ' 个表情';
    authorText.appendChild(meta);

    // 有作者 uid 时，点击头像或作者名打开作者的 iirose 用户名片。
    if (pack.authorUid) {
      author.classList.add('iirose-emoji-market-author--link');
      author.title = '查看作者主页';
      author.addEventListener('click', () => openAuthorCard(pack.authorUid, author));
      meta.classList.add('iirose-emoji-market-author--link');
      meta.title = '查看作者主页';
      meta.addEventListener('click', () => openAuthorCard(pack.authorUid, meta));
    }

    const desc = document.createElement('div');
    desc.className = 'iirose-emoji-market-desc';
    desc.textContent = pack.desc || '暂无描述。';
    body.appendChild(desc);

    const tags = document.createElement('div');
    tags.className = 'iirose-emoji-market-tags';
    if (pack.tags.length) {
      pack.tags.forEach((tagText) => {
        const tag = document.createElement('span');
        tag.className = 'iirose-emoji-market-tag';
        tag.textContent = tagText;
        tags.appendChild(tag);
      });
    } else {
      const tag = document.createElement('span');
      tag.className = 'iirose-emoji-market-tag iirose-emoji-market-tag--muted';
      tag.textContent = '未分类标签';
      tags.appendChild(tag);
    }
    body.appendChild(tags);

    const actions = document.createElement('div');
    actions.className = 'iirose-emoji-market-actions';
    body.appendChild(actions);

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'iirose-emoji-market-import';
    importButton.textContent = '导入';
    actions.appendChild(importButton);

    importButton.addEventListener('click', () => {
      importMarketPack(pack, importButton, status);
    });

    return card;
  }

  function importMarketPack(pack, button, status) {
    if (!pack || !pack.url) {
      showSyncToast('表情包地址无效。', true);
      return;
    }

    const oldText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = '导入中...';
    }
    if (status) status.textContent = '正在导入“' + pack.name + '”...';

    fetchJson(pack.url)
      .then((parsed) => {
        const categories = extractImportedCategories(parsed);
        if (!categories.length) {
          throw new Error('这个表情包没有可导入的分类数据。');
        }

        const result = applyImportedCategories(categories, 'merge');
        barSignature = '';
        renderCategoryBar();
        applyCategoryFilter();

        if (status) status.textContent = '已导入“' + pack.name + '”。';
        showSyncToast('已导入“' + pack.name + '”：' + result.message);
      })
      .catch((error) => {
        if (status) status.textContent = error && error.message ? error.message : '导入失败。';
        showSyncToast(error && error.message ? error.message : '导入失败。', true);
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
          button.textContent = oldText || '导入';
        }
      });
  }

  // 打开市场作者的 iirose 用户名片。
  // 依据 getUserCard 源码：i ? o.function.event.call(this,7,[...]) : getProfile(e,t)。
  // event(7) 那条会从 this 上读取上下文（原生 this 是 followName2 / 房间用户菜单项，带 data-uid/n/rid 等），
  // 我们的市场 div 没有这些属性，会让站内 buildSelect2 读 undefined.length 报错——所以连「作者在房间」也崩。
  // getProfile(uid, 1) 是「本地找不到用户」时的远程拉取分支，不依赖 this，对在线/离线/不在房间的用户都适用，直接走它最稳。
  function openAuthorCard(uid, anchorEl) {
    if (!uid) return;
    const win = getIIROSEWindow() || window;

    try {
      if (typeof win.getProfile === 'function') {
        win.getProfile(uid, 1);
        return;
      }
    } catch (error) {
      // 落到下面的 getUserCard 退路。
    }

    // 退路：直接调 getUserCard（命中本地用户时可能因 this 上下文报错，故包 try/catch）。
    try {
      if (win.Utils && win.Utils.service && typeof win.Utils.service.getUserCard === 'function') {
        win.Utils.service.getUserCard.call(anchorEl, uid, 1);
        return;
      }
    } catch (error) {
      // 吞掉异常走 toast。
    }

    showSyncToast('暂时无法打开该作者主页。', true);
  }

  function createCategoryId() {
    return 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function copyTextToClipboard(text, textarea) {
    const fallbackCopy = () => {
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        closeDialog();
        showSyncToast('导出文本已复制。');
      } catch (error) {
        showSyncToast('复制失败，请手动复制文本。', true);
      }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          closeDialog();
          showSyncToast('导出文本已复制。');
        })
        .catch(fallbackCopy);
      return;
    }

    fallbackCopy();
  }

  function showTextDialog(options) {
    closeDialog();

    const dialog = createDialogShell({
      title: options.title || '编辑',
      confirmText: options.confirmText || '确定',
      danger: false,
    });

    const inputWrap = document.createElement('div');
    inputWrap.className = 'iirose-emoji-dialog-input-wrap';

    const input = document.createElement('input');
    input.className = 'iirose-emoji-dialog-input';
    input.type = 'text';
    input.placeholder = options.placeholder || '请输入内容 . . .';
    input.maxLength = 18;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = options.value || '';
    inputWrap.appendChild(input);
    dialog.content.appendChild(inputWrap);

    dialog.confirmButton.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        dialog.root.classList.add('iirose-emoji-dialog--shake');
        window.setTimeout(() => dialog.root.classList.remove('iirose-emoji-dialog--shake'), 220);
        return;
      }

      closeDialog();
      if (typeof options.onConfirm === 'function') options.onConfirm(value);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        dialog.confirmButton.click();
      }
    });

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  function showTextareaDialog(options) {
    closeDialog();

    const dialog = createDialogShell({
      title: options.title || '编辑',
      confirmText: options.confirmText || '确定',
      danger: false,
    });

    const textarea = document.createElement('textarea');
    textarea.className = 'iirose-emoji-dialog-textarea';
    textarea.placeholder = options.placeholder || '请输入内容 . . .';
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.value = options.value || '';
    textarea.readOnly = Boolean(options.readOnly);
    dialog.content.appendChild(textarea);

    dialog.confirmButton.addEventListener('click', () => {
      const value = textarea.value.trim();
      if (!value) {
        textarea.focus();
        dialog.root.classList.add('iirose-emoji-dialog--shake');
        window.setTimeout(() => dialog.root.classList.remove('iirose-emoji-dialog--shake'), 220);
        return;
      }

      if (typeof options.onConfirm === 'function') {
        const shouldClose = options.onConfirm(value, textarea, dialog);
        if (shouldClose === false) return;
      } else {
        closeDialog();
      }
    });

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        dialog.confirmButton.click();
      }
    });

    window.setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 0);
  }

  function showConfirmDialog(options) {
    closeDialog();

    const dialog = createDialogShell({
      title: options.title || '确认',
      confirmText: options.confirmText || '确定',
      danger: Boolean(options.danger),
    });

    const message = document.createElement('div');
    message.className = 'iirose-emoji-dialog-message';
    message.textContent = options.message || '';
    dialog.content.appendChild(message);

    dialog.confirmButton.addEventListener('click', () => {
      closeDialog();
      if (typeof options.onConfirm === 'function') options.onConfirm();
    });
  }

  function createDialogShell(options) {
    const root = document.createElement('div');
    root.className = 'iirose-emoji-dialog';
    // 在首次定位前就加上变体类，保证 positionDialog 量到的是最终面板宽度（市场弹窗更宽）。
    if (options.rootClass) root.classList.add(options.rootClass);

    const panel = document.createElement('div');
    panel.className = 'iirose-emoji-dialog-panel';
    root.appendChild(panel);

    const header = document.createElement('div');
    header.className = 'iirose-emoji-dialog-header';
    panel.appendChild(header);

    const icon = document.createElement('span');
    icon.className = 'iirose-emoji-dialog-header-icon mdi-card-text-outline';
    header.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'iirose-emoji-dialog-title';
    title.textContent = options.title;
    header.appendChild(title);

    const closeIcon = document.createElement('button');
    closeIcon.type = 'button';
    closeIcon.className = 'iirose-emoji-dialog-close mdi-emoticon-happy-outline';
    closeIcon.title = '取消';
    header.appendChild(closeIcon);

    const content = document.createElement('div');
    content.className = 'iirose-emoji-dialog-content';
    panel.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'iirose-emoji-dialog-footer';
    panel.appendChild(footer);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'iirose-emoji-dialog-button iirose-emoji-dialog-button--cancel';
    cancelButton.innerHTML = '<span class="buttonIcon mdi-cancel"></span><span class="buttonText">取消</span>';
    footer.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'iirose-emoji-dialog-button iirose-emoji-dialog-button--confirm';
    if (options.danger) confirmButton.classList.add('iirose-emoji-dialog-button--danger');
    confirmButton.innerHTML = '<span class="buttonIcon mdi-check"></span><span class="buttonText"></span>';
    confirmButton.querySelector('.buttonText').textContent = options.confirmText || '确定';
    footer.appendChild(confirmButton);

    const close = () => closeDialog();
    closeIcon.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    document.body.appendChild(root);
    activeDialog = root;
    positionDialog(root);
    window.setTimeout(() => positionDialog(root), 80);
    return {
      root,
      content,
      confirmButton,
    };
  }

  function positionFloatingPanels() {
    if (activeDialog) positionDialog(activeDialog);
    if (shareMenu) positionShareMenu(shareMenu);
  }

  function positionActiveDialog() {
    positionFloatingPanels();
  }

  function positionDialog(root) {
    const panel = root && root.querySelector('.iirose-emoji-dialog-panel');
    if (!panel) return;

    const viewport = getViewportRect();
    const panelRect = panel.getBoundingClientRect();
    const { left, top } = placeFloatingPanel(viewport, panelRect, getEmojiPageAnchorRect());
    const padding = Math.min(24, Math.max(12, viewport.height * 0.025));

    root.style.setProperty('--iirose-emoji-dialog-left', left + 'px');
    root.style.setProperty('--iirose-emoji-dialog-top', top + 'px');
    root.style.setProperty('--iirose-emoji-dialog-max-height', Math.max(220, viewport.height - padding * 2) + 'px');
  }

  function positionShareMenu(root) {
    const panel = root && root.querySelector('.iirose-emoji-share-menu-panel');
    if (!panel) return;

    const viewport = getViewportRect();
    const panelRect = panel.getBoundingClientRect();
    const { left, top } = placeFloatingPanel(viewport, panelRect, getEmojiPageAnchorRect());
    const padding = Math.min(24, Math.max(12, viewport.height * 0.025));

    root.style.setProperty('--iirose-emoji-share-menu-left', left + 'px');
    root.style.setProperty('--iirose-emoji-share-menu-top', top + 'px');
    root.style.setProperty('--iirose-emoji-share-menu-max-height', Math.max(180, viewport.height - padding * 2) + 'px');
  }

  // 水平：始终按可视视口居中——这是本次要修的「弹窗超出右屏」根因。官方表情面板被包在
  // transform: scale()+translateX() 的轮播容器里，跟随它的水平锚点会拿到被缩放/平移
  // （甚至命中非当前翻页）的 rect，其水平中心 ≠ 视口中心，把弹窗推出右侧。
  // 垂直：浮在表情面板上方（用锚点 top；各翻页 .emojiPage 同属一行，top 一致且可靠），
  // 拿不到锚点时退回视口垂直居中。clamp 保证顶端不超出视口（电脑端不再顶部溢出）。
  function placeFloatingPanel(viewport, panelRect, anchorRect) {
    const padding = Math.min(24, Math.max(12, viewport.height * 0.025));
    const gap = 12;
    const preferredLeft = viewport.left + (viewport.width - panelRect.width) / 2;
    const preferredTop = anchorRect
      ? anchorRect.top - panelRect.height - gap
      : viewport.top + (viewport.height - panelRect.height) / 2;
    return {
      left: clamp(preferredLeft, viewport.left + padding, viewport.left + viewport.width - panelRect.width - padding),
      top: clamp(preferredTop, viewport.top + padding, viewport.top + viewport.height - panelRect.height - padding),
    };
  }

  function getEmojiPageAnchorRect() {
    const anchor = document.querySelector('#faceHolder > div:nth-child(2) > div > div.emojiPage') ||
      document.querySelector(CUSTOM_EMOJI_PAGE_SELECTOR);
    return anchor && anchor.getBoundingClientRect();
  }

  function getViewportRect() {
    if (window.visualViewport) {
      return {
        left: window.visualViewport.offsetLeft || 0,
        top: window.visualViewport.offsetTop || 0,
        width: window.visualViewport.width || document.documentElement.clientWidth || window.innerWidth,
        height: window.visualViewport.height || document.documentElement.clientHeight || window.innerHeight,
      };
    }

    return {
      left: 0,
      top: 0,
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
    };
  }

  function closeDialog() {
    if (!activeDialog) return;
    activeDialog.remove();
    activeDialog = null;
  }

  function toggleEmojiInCategory(categoryId, emojiUrl) {
    if (!categoryId || !emojiUrl) return;

    const state = loadState();
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category) return;

    const index = category.items.indexOf(emojiUrl);
    let removed = false;
    if (index >= 0) {
      category.items.splice(index, 1);
      removed = true;
    } else {
      category.items.push(emojiUrl);
    }

    saveState(state);
    if (removed) {
      cleanupExtraEmojiState(state);
      syncExtraEmojiItems();
    }
    renderCategoryBar();
    applyCategoryFilter();
  }

  function removeEmojiFromCategory(categoryId, emojiUrl) {
    if (!categoryId || categoryId === ALL_CATEGORY_ID || !emojiUrl) return;

    const state = loadState();
    const category = state.categories.find((item) => item.id === categoryId);
    if (!category) return;

    category.items = category.items.filter((item) => item !== emojiUrl);
    saveState(state);
    cleanupExtraEmojiState(state);
    syncExtraEmojiItems();
    renderCategoryBar();
    applyCategoryFilter();
  }

  function applyCategoryFilter() {
    const state = loadState();
    const items = getCustomEmojiItems();
    const activeCategory = state.categories.find((category) => category.id === state.activeCategoryId);
    const allowedUrls = activeCategory ? new Set(activeCategory.items) : null;

    if (!activeCategory && state.activeCategoryId !== ALL_CATEGORY_ID) {
      state.activeCategoryId = ALL_CATEGORY_ID;
      saveState(state);
      renderCategoryBar();
    }

    items.forEach((item) => {
      const url = getEmojiItemUrl(item);
      const hidden = Boolean(allowedUrls && !allowedUrls.has(url));
      item.classList.toggle('iirose-emoji-category-hidden', hidden);
    });
  }

  function pruneCategories() {
    const existingUrls = new Set(getCustomEmojiItems().map(getEmojiItemUrl).filter(Boolean));
    if (!existingUrls.size) return;

    const state = loadState();
    let changed = false;

    state.categories.forEach((category) => {
      const nextItems = category.items.filter((url) => existingUrls.has(url));
      if (nextItems.length !== category.items.length) {
        category.items = nextItems;
        changed = true;
      }
    });

    if (changed) saveState(state);
  }

  function getCustomEmojiItems() {
    return Array.from(document.querySelectorAll(CUSTOM_EMOJI_BOX_SELECTOR + ' .faceHolderBoxChildItem[c]'))
      .filter((item) => getEmojiItemUrl(item));
  }

  function syncExtraEmojiItems() {
    const box = document.querySelector(CUSTOM_EMOJI_BOX_SELECTOR);
    if (!box) return;

    const extraState = loadExtraEmojiState();
    const desiredUrls = extraState.items.slice();
    const currentInjectedUrls = getInjectedExtraEmojiItems(box).map(getEmojiItemUrl);
    const officialUrls = new Set(getOfficialEmojiItems(box).map(getEmojiItemUrl));
    const nextInjectedUrls = desiredUrls.filter((url) => url && !officialUrls.has(url));

    if (isSameStringArray(currentInjectedUrls, nextInjectedUrls)) return;

    getInjectedExtraEmojiItems(box).forEach((item) => item.remove());

    if (!nextInjectedUrls.length) return;

    const templateItem = getTemplateEmojiItem(box);
    nextInjectedUrls.forEach((url) => {
      const item = createExtraEmojiItem(url, templateItem);
      if (item) box.appendChild(item);
    });
  }

  function getOfficialEmojiItems(box) {
    return Array.from(box.querySelectorAll('.faceHolderBoxChildItem[c]'))
      .filter((item) => item.dataset.iiroseExtraEmoji !== '1')
      .filter((item) => getEmojiItemUrl(item));
  }

  function getInjectedExtraEmojiItems(box) {
    return Array.from(box.querySelectorAll('.faceHolderBoxChildItem[data-iirose-extra-emoji="1"]'))
      .filter((item) => getEmojiItemUrl(item));
  }

  function getTemplateEmojiItem(box) {
    return getOfficialEmojiItems(box)[0] || null;
  }

  function createExtraEmojiItem(url, templateItem) {
    const normalizedUrl = normalizeEmojiUrl(url);
    if (!normalizedUrl) return null;

    const item = templateItem
      ? templateItem.cloneNode(true)
      : createFallbackEmojiItem();

    item.dataset.iiroseExtraEmoji = '1';
    item.setAttribute('c', normalizedUrl);
    item.classList.remove('iirose-emoji-category-hidden');
    item.removeAttribute('data-probe-url');

    if (!item.getAttribute('onclick')) {
      item.setAttribute('onclick', 'Objs.faceHolder.function.event.call(this,2,event);');
    }
    if (!item.getAttribute('onmouseenter')) {
      item.setAttribute('onmouseenter', 'Objs.faceHolder.function.event.call(this,0,event);Utils.Sound.play(0);');
    }
    if (!item.getAttribute('onmouseleave')) {
      item.setAttribute('onmouseleave', 'Objs.faceHolder.function.event(1);');
    }

    const img = item.querySelector('img');
    if (img) {
      img.src = normalizedUrl;
      img.removeAttribute('srcset');
      img.removeAttribute('data-src');
      img.style.display = '';
    }

    return item;
  }

  function createFallbackEmojiItem() {
    const item = document.createElement('div');
    item.className = 'faceHolderBoxChildItem';
    item.setAttribute('onclick', 'Objs.faceHolder.function.event.call(this,2,event);');
    item.setAttribute('onmouseenter', 'Objs.faceHolder.function.event.call(this,0,event);Utils.Sound.play(0);');
    item.setAttribute('onmouseleave', 'Objs.faceHolder.function.event(1);');

    const content = document.createElement('div');
    content.className = 'faceHolderBoxChildItemC';
    content.style.height = '80px';
    content.style.lineHeight = '80px';
    content.style.fontSize = '50px';
    content.style.setProperty('font-size', '50px', 'important');

    const emojiImg = document.createElement('div');
    emojiImg.className = 'emojiImg';
    emojiImg.style.height = '80px';

    const bgImgBox = document.createElement('div');
    bgImgBox.className = 'bgImgBox';

    const img = document.createElement('img');
    img.className = 'bgImg';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.setAttribute('onerror', "this.style.display='none';");
    img.style.objectFit = 'contain';

    const fullBox = document.createElement('div');
    fullBox.className = 'fullBox';

    bgImgBox.appendChild(img);
    bgImgBox.appendChild(fullBox);
    emojiImg.appendChild(bgImgBox);
    content.appendChild(emojiImg);
    item.appendChild(content);
    return item;
  }

  function findCustomEmojiItem(target) {
    if (!target || target.nodeType !== 1) return null;

    const item = target.closest(CUSTOM_EMOJI_BOX_SELECTOR + ' .faceHolderBoxChildItem[c]');
    if (!item) return null;
    return getEmojiItemUrl(item) ? item : null;
  }

  function findCategoryButton(target) {
    if (!target || target.nodeType !== 1) return null;

    const button = target.closest('.iirose-emoji-category-bar .iirose-emoji-category-button[data-emoji-category-id]');
    if (!button) return null;
    const categoryId = button.dataset.emojiCategoryId;
    if (!categoryId || categoryId === ALL_CATEGORY_ID) return null;
    return button;
  }

  function getEmojiItemUrl(item) {
    const value = item && item.getAttribute && item.getAttribute('c');
    const normalized = normalizeEmojiUrl(value);
    return isSafeEmojiUrl(normalized) ? normalized : '';
  }

  function normalizeEmojiUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.startsWith('s://')) return 'https://' + value.slice(4);
    if (value.startsWith('://')) return 'http://' + value.slice(3);
    return value;
  }

  // 只接受规范化后的 http(s) 链接，挡掉 javascript:/data:/ftp: 等异常协议。
  function isSafeEmojiUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  function isSameStringArray(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  function isCustomEmojiPanelActive() {
    const content = document.querySelector(CUSTOM_EMOJI_CONTENT_SELECTOR);
    if (!content) return false;

    const style = getComputedStyle(content);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return Number(style.opacity || 1) > 0;
  }

  function loadState() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      raw = null;
    }

    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        parsed = null;
      }
    }

    const state = {
      activeCategoryId: ALL_CATEGORY_ID,
      categories: [],
    };

    if (parsed && typeof parsed === 'object') {
      state.activeCategoryId = typeof parsed.activeCategoryId === 'string'
        ? parsed.activeCategoryId
        : ALL_CATEGORY_ID;

      if (Array.isArray(parsed.categories)) {
        state.categories = parsed.categories
          .map(sanitizeCategory)
          .filter(Boolean);
      }
    }

    if (state.activeCategoryId !== ALL_CATEGORY_ID && !hasCategory(state, state.activeCategoryId)) {
      state.activeCategoryId = ALL_CATEGORY_ID;
    }

    return state;
  }

  function loadExtraEmojiState() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(EXTRA_STORAGE_KEY);
    } catch (error) {
      raw = null;
    }

    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        parsed = null;
      }
    }

    const seen = new Set();
    const items = parsed && Array.isArray(parsed.items)
      ? parsed.items
        .map(normalizeEmojiUrl)
        .filter((url) => isSafeEmojiUrl(url))
        .filter((url) => {
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        })
      : [];

    return { items };
  }

  function cleanupExtraEmojiState(state) {
    const currentState = state || loadState();
    const extraState = loadExtraEmojiState();
    if (!extraState.items.length) return false;

    const officialUrls = loadOfficialEmojiUrlSet();
    const referencedUrls = new Set();
    currentState.categories.forEach((category) => {
      category.items.forEach((url) => {
        const normalized = normalizeEmojiUrl(url);
        if (normalized) referencedUrls.add(normalized);
      });
    });

    const nextItems = extraState.items.filter((url) => {
      const normalized = normalizeEmojiUrl(url);
      if (!normalized) return false;
      if (officialUrls.has(normalized)) return false;
      return referencedUrls.has(normalized);
    });

    if (nextItems.length === extraState.items.length) return false;
    saveExtraEmojiState({ items: nextItems });
    return true;
  }

  function loadOfficialEmojiUrlSet() {
    let raw = '';
    try {
      raw = window.localStorage.getItem('myEmoji') || '';
    } catch (error) {
      raw = '';
    }

    return new Set(
      String(raw)
        .split(/\s+/)
        .map(normalizeEmojiUrl)
        .filter((url) => isSafeEmojiUrl(url))
    );
  }

  function sanitizeCategory(category) {
    if (!category || typeof category !== 'object') return null;

    const id = String(category.id || '').trim();
    const name = String(category.name || '').trim();
    if (!id || !name || id === ALL_CATEGORY_ID) return null;

    const seen = new Set();
    const items = Array.isArray(category.items) ? category.items : [];

    return {
      id,
      name: name.slice(0, 18),
      items: items
        .map(normalizeEmojiUrl)
        .filter((url) => isSafeEmojiUrl(url))
        .filter((url) => {
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        }),
    };
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeCategoryId: state.activeCategoryId || ALL_CATEGORY_ID,
        categories: state.categories.map(sanitizeCategory).filter(Boolean),
      }));
    } catch (error) {
      // localStorage may be unavailable in restricted browser modes.
    }
  }

  function saveExtraEmojiState(state) {
    try {
      window.localStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify({
        items: Array.isArray(state && state.items)
          ? state.items
            .map(normalizeEmojiUrl)
            .filter((url) => isSafeEmojiUrl(url))
            .filter((url, index, list) => list.indexOf(url) === index)
          : [],
      }));
    } catch (error) {
      // localStorage may be unavailable in restricted browser modes.
    }
  }

  function hasCategory(state, categoryId) {
    if (categoryId === ALL_CATEGORY_ID) return true;
    return state.categories.some((category) => category.id === categoryId);
  }

  function categoryContainsEmoji(state, categoryId, emojiUrl) {
    const category = state.categories.find((item) => item.id === categoryId);
    return Boolean(category && category.items.includes(emojiUrl));
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }

  function injectStyle() {
    let style = document.getElementById('iirose-emoji-categories-style');

    if (!style) {
      style = document.createElement('style');
      style.id = 'iirose-emoji-categories-style';
      document.head.appendChild(style);
    }

    style.textContent = `
#faceHolder .emojiContentBox[index="4"] .emojiPage .iirose-emoji-category-bar {
  box-sizing: border-box !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  max-width: calc(100% - 42px) !important;
  height: 100% !important;
  margin-left: 6px !important;
  padding: 0 4px !important;
  overflow: hidden !important;
  vertical-align: top !important;
  background: transparent !important;
  border: 0 !important;
}

.iirose-emoji-category-actions,
.iirose-emoji-category-scroll {
  box-sizing: border-box !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  min-width: 0 !important;
  height: 100% !important;
}

.iirose-emoji-category-actions {
  flex: 0 0 auto !important;
}

.iirose-emoji-category-scroll {
  flex: 1 1 auto !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  overscroll-behavior-x: contain !important;
  touch-action: pan-x !important;
  -webkit-overflow-scrolling: touch !important;
  scrollbar-width: none !important;
}

#faceHolder .emojiContentBox[index="4"] .emojiPage .iirose-emoji-category-bar[hidden] {
  display: none !important;
}

.iirose-emoji-category-scroll::-webkit-scrollbar {
  display: none !important;
}

.iirose-emoji-category-button {
  box-sizing: border-box !important;
  flex: 0 0 auto !important;
  max-width: 96px !important;
  height: 24px !important;
  padding: 0 10px !important;
  border: 1px solid rgba(0, 0, 0, 0.12) !important;
  border-radius: 6px !important;
  background: #fff !important;
  color: #222 !important;
  font-size: 13px !important;
  line-height: 22px !important;
  text-align: center !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  cursor: pointer !important;
}

.iirose-emoji-category-button--active {
  background: #2f7cf6 !important;
  border-color: #2f7cf6 !important;
  color: #fff !important;
}

.iirose-emoji-category-button--add {
  width: 28px !important;
  padding: 0 !important;
  font-size: 18px !important;
  line-height: 20px !important;
}

.iirose-emoji-category-button--more,
.iirose-emoji-category-button--share {
  width: 42px !important;
  padding: 0 !important;
  font-size: 13px !important;
  line-height: 22px !important;
}

.iirose-emoji-category-button--sent {
  background: #4caf50 !important;
  border-color: #4caf50 !important;
  color: #fff !important;
}

.iirose-emoji-category-hidden {
  display: none !important;
}

.iirose-emoji-category-menu {
  box-sizing: border-box !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  width: 168px !important;
  max-width: calc(100vw - 16px) !important;
  padding: 8px !important;
  border-radius: 8px !important;
  background: rgba(48, 48, 48, 0.96) !important;
  color: #fff !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24) !important;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.iirose-emoji-category-menu-title {
  box-sizing: border-box !important;
  padding: 2px 4px 8px !important;
  font-size: 13px !important;
  line-height: 18px !important;
  color: rgba(255, 255, 255, 0.72) !important;
}

.iirose-emoji-category-menu-empty {
  box-sizing: border-box !important;
  padding: 8px 4px !important;
  font-size: 13px !important;
  line-height: 18px !important;
  color: rgba(255, 255, 255, 0.6) !important;
}

.iirose-emoji-category-menu-button {
  box-sizing: border-box !important;
  display: block !important;
  width: 100% !important;
  min-height: 32px !important;
  margin: 0 !important;
  padding: 7px 8px !important;
  border: 0 !important;
  border-radius: 6px !important;
  background: transparent !important;
  color: #fff !important;
  font-size: 14px !important;
  line-height: 18px !important;
  text-align: left !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  cursor: pointer !important;
}

.iirose-emoji-category-menu-button:hover {
  background: rgba(255, 255, 255, 0.12) !important;
}

.iirose-emoji-category-menu-button--primary {
  margin-top: 4px !important;
  background: rgba(47, 124, 246, 0.92) !important;
}

.iirose-emoji-category-menu-button--danger {
  color: #ffdddd !important;
}

.iirose-emoji-category-menu-button--danger:hover {
  background: rgba(214, 65, 65, 0.32) !important;
}

.iirose-emoji-category-menu-button--active {
  background: rgba(47, 124, 246, 0.92) !important;
}

.iirose-emoji-category-picker {
  width: 188px !important;
  max-height: min(320px, calc(100vh - 24px)) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
}

.iirose-emoji-share-menu {
  box-sizing: border-box !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: block !important;
  padding: 20px !important;
  background: rgba(0, 0, 0, 0.68) !important;
  color: rgba(255, 255, 255, 0.86) !important;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.iirose-emoji-share-menu-panel {
  box-sizing: border-box !important;
  position: fixed !important;
  left: var(--iirose-emoji-share-menu-left, 50%) !important;
  top: var(--iirose-emoji-share-menu-top, 50%) !important;
  width: min(640px, calc(100vw - 40px)) !important;
  max-height: min(520px, var(--iirose-emoji-share-menu-max-height, calc(100vh - 40px))) !important;
  overflow-y: auto !important;
  background: rgba(33, 33, 33, 0.92) !important;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.38) !important;
}

.iirose-emoji-share-menu-header {
  box-sizing: border-box !important;
  height: 82px !important;
  padding: 0 44px !important;
  display: flex !important;
  align-items: center !important;
  background: rgba(48, 48, 48, 0.96) !important;
  border-bottom: 1px solid rgba(0, 0, 0, 0.28) !important;
  color: rgba(255, 255, 255, 0.86) !important;
  font-weight: bold !important;
  font-size: 24px !important;
  line-height: 32px !important;
}

.iirose-emoji-share-menu-item {
  box-sizing: border-box !important;
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  width: 100% !important;
  min-height: 92px !important;
  margin: 0 !important;
  padding: 24px 48px 24px 124px !important;
  border: 0 !important;
  background: transparent !important;
  color: rgba(255, 255, 255, 0.86) !important;
  font-weight: bold !important;
  font-size: 24px !important;
  line-height: 34px !important;
  text-align: left !important;
  cursor: pointer !important;
}

.iirose-emoji-share-menu-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}

.iirose-emoji-share-menu-icon {
  position: absolute !important;
  left: 44px !important;
  top: 50% !important;
  width: 44px !important;
  height: 44px !important;
  transform: translateY(-50%) !important;
  font-family: md !important;
  font-size: 34px !important;
  line-height: 44px !important;
  text-align: center !important;
  opacity: 0.76 !important;
}

.iirose-emoji-share-menu-label {
  min-width: 0 !important;
  overflow-wrap: anywhere !important;
}

.iirose-emoji-sync-toast {
  box-sizing: border-box !important;
  position: fixed !important;
  left: 50% !important;
  top: 20px !important;
  z-index: 2147483647 !important;
  max-width: calc(100vw - 32px) !important;
  padding: 10px 18px !important;
  transform: translateX(-50%) !important;
  border-radius: 8px !important;
  background: rgba(76, 175, 80, 0.96) !important;
  color: #fff !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24) !important;
  font-weight: bold !important;
  font-size: 14px !important;
  line-height: 20px !important;
  text-align: center !important;
}

.iirose-emoji-sync-toast--danger {
  background: rgba(184, 92, 92, 0.96) !important;
}

.iirose-emoji-dialog {
  box-sizing: border-box !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: block !important;
  background: transparent !important;
  color: #333 !important;
  padding: 0 !important;
  pointer-events: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

.iirose-emoji-dialog-panel {
  box-sizing: border-box !important;
  position: fixed !important;
  left: var(--iirose-emoji-dialog-left, 50%) !important;
  top: var(--iirose-emoji-dialog-top, 50%) !important;
  width: min(684px, calc(100vw - 48px)) !important;
  height: 384px !important;
  max-height: var(--iirose-emoji-dialog-max-height, calc(100vh - 48px)) !important;
  display: flex !important;
  flex-direction: column !important;
  background: rgba(240, 240, 240, 0.58) !important;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.2) !important;
  pointer-events: auto !important;
}

.iirose-emoji-dialog--market .iirose-emoji-dialog-panel {
  width: min(840px, calc(100vw - 32px)) !important;
  height: min(640px, calc(100vh - 40px)) !important;
}

.iirose-emoji-dialog-header {
  box-sizing: border-box !important;
  flex: 0 0 48px !important;
  display: flex !important;
  align-items: center !important;
  gap: 20px !important;
  padding: 0 28px !important;
  background: #6589cc !important;
  color: rgba(255, 255, 255, 0.92) !important;
  font-weight: bold !important;
}

.iirose-emoji-dialog-header-icon,
.iirose-emoji-dialog-close {
  width: 34px !important;
  height: 34px !important;
  line-height: 34px !important;
  font-family: md !important;
  font-size: 30px !important;
  text-align: center !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

.iirose-emoji-dialog-title {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  font-size: 20px !important;
  line-height: 30px !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.iirose-emoji-dialog-close {
  flex: 0 0 auto !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  cursor: pointer !important;
}

.iirose-emoji-dialog-content {
  box-sizing: border-box !important;
  flex: 1 1 auto !important;
  min-height: 0 !important;
  padding: 30px 28px !important;
  overflow: auto !important;
  background: rgba(240, 240, 240, 0.78) !important;
}

.iirose-emoji-dialog-input-wrap {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 520px !important;
}

.iirose-emoji-dialog-input {
  box-sizing: border-box !important;
  width: 100% !important;
  height: 52px !important;
  padding: 0 2px !important;
  border: 0 !important;
  border-bottom: 2px solid rgba(101, 137, 204, 0.6) !important;
  outline: 0 !important;
  background: transparent !important;
  color: #333 !important;
  font-weight: bold !important;
  font-size: 20px !important;
  line-height: 52px !important;
}

.iirose-emoji-dialog-input::placeholder {
  color: rgba(60, 60, 60, 0.62) !important;
}

.iirose-emoji-dialog-textarea {
  box-sizing: border-box !important;
  width: 100% !important;
  height: 100% !important;
  min-height: 220px !important;
  padding: 18px 20px !important;
  border: 0 !important;
  outline: 0 !important;
  resize: none !important;
  background: rgba(255, 255, 255, 0.42) !important;
  color: #333 !important;
  font-weight: bold !important;
  font-size: 15px !important;
  line-height: 24px !important;
  white-space: pre !important;
  overflow: auto !important;
}

.iirose-emoji-dialog-textarea::placeholder {
  color: rgba(60, 60, 60, 0.62) !important;
}

.iirose-emoji-dialog-message {
  box-sizing: border-box !important;
  max-width: 680px !important;
  padding: 8px 0 !important;
  color: rgba(45, 45, 45, 0.82) !important;
  font-weight: bold !important;
  font-size: 18px !important;
  line-height: 30px !important;
}

.iirose-emoji-market-toolbar {
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  justify-content: space-between !important;
  padding: 0 0 16px !important;
}

.iirose-emoji-market-status {
  min-width: 0 !important;
  color: rgba(45, 45, 45, 0.78) !important;
  font-weight: bold !important;
  font-size: 14px !important;
  line-height: 20px !important;
}

.iirose-emoji-market-refresh,
.iirose-emoji-market-import {
  box-sizing: border-box !important;
  flex: 0 0 auto !important;
  min-height: 34px !important;
  padding: 0 14px !important;
  border: 0 !important;
  border-radius: 6px !important;
  background: #6589cc !important;
  color: rgba(255, 255, 255, 0.94) !important;
  font-weight: bold !important;
  font-size: 14px !important;
  line-height: 34px !important;
  cursor: pointer !important;
}

.iirose-emoji-market-refresh[disabled],
.iirose-emoji-market-import[disabled] {
  opacity: 0.6 !important;
  cursor: default !important;
}

.iirose-emoji-market-list {
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 12px !important;
}

.iirose-emoji-market-empty {
  box-sizing: border-box !important;
  padding: 28px 18px !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.5) !important;
  color: rgba(45, 45, 45, 0.78) !important;
  font-weight: bold !important;
  font-size: 15px !important;
  line-height: 22px !important;
  text-align: center !important;
}

.iirose-emoji-market-card {
  box-sizing: border-box !important;
  display: grid !important;
  grid-template-columns: 124px minmax(0, 1fr) !important;
  gap: 14px !important;
  padding: 12px !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.58) !important;
}

.iirose-emoji-market-cover {
  display: block !important;
  width: 124px !important;
  height: 124px !important;
  border-radius: 8px !important;
  background: rgba(120, 120, 120, 0.12) !important;
  object-fit: cover !important;
}

.iirose-emoji-market-cover[data-empty="1"] {
  background: rgba(120, 120, 120, 0.16) !important;
}

.iirose-emoji-market-body {
  min-width: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
}

.iirose-emoji-market-author {
  position: relative !important;
  width: 38px !important;
  height: 38px !important;
}

.iirose-emoji-market-avatar {
  display: block !important;
  width: 38px !important;
  height: 38px !important;
  border-radius: 999px !important;
  background: rgba(120, 120, 120, 0.16) !important;
  object-fit: cover !important;
}

.iirose-emoji-market-avatar[data-empty="1"] {
  background: rgba(120, 120, 120, 0.2) !important;
}

.iirose-emoji-market-author-text {
  min-width: 0 !important;
}

.iirose-emoji-market-title {
  color: #2c2c2c !important;
  font-weight: bold !important;
  font-size: 18px !important;
  line-height: 26px !important;
}

.iirose-emoji-market-meta {
  color: rgba(60, 60, 60, 0.78) !important;
  font-weight: bold !important;
  font-size: 13px !important;
  line-height: 18px !important;
  overflow-wrap: anywhere !important;
}

.iirose-emoji-market-author--link {
  cursor: pointer !important;
}

.iirose-emoji-market-author--link:hover {
  text-decoration: underline !important;
  opacity: 0.86 !important;
}

.iirose-emoji-market-desc {
  color: rgba(45, 45, 45, 0.86) !important;
  font-size: 14px !important;
  line-height: 21px !important;
  overflow-wrap: anywhere !important;
}

.iirose-emoji-market-tags {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 8px !important;
}

.iirose-emoji-market-tag {
  box-sizing: border-box !important;
  min-height: 26px !important;
  padding: 4px 10px !important;
  border-radius: 999px !important;
  background: rgba(101, 137, 204, 0.14) !important;
  color: #4a69a8 !important;
  font-weight: bold !important;
  font-size: 12px !important;
  line-height: 18px !important;
}

.iirose-emoji-market-tag--muted {
  background: rgba(120, 120, 120, 0.12) !important;
  color: rgba(80, 80, 80, 0.7) !important;
}

.iirose-emoji-market-actions {
  display: flex !important;
  justify-content: flex-end !important;
  padding-top: 2px !important;
}

.iirose-emoji-import-hint {
  box-sizing: border-box !important;
  padding: 0 0 12px !important;
  color: rgba(45, 45, 45, 0.78) !important;
  font-weight: bold !important;
  font-size: 14px !important;
  line-height: 20px !important;
}

.iirose-emoji-import-list {
  box-sizing: border-box !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
}

.iirose-emoji-import-row {
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  width: 100% !important;
  min-height: 44px !important;
  margin: 0 !important;
  padding: 8px 14px !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.6) !important;
  color: #333 !important;
  font-size: 16px !important;
  line-height: 22px !important;
  cursor: pointer !important;
}

.iirose-emoji-import-row:hover {
  background: rgba(255, 255, 255, 0.85) !important;
}

.iirose-emoji-import-checkbox {
  flex: 0 0 auto !important;
  width: 18px !important;
  height: 18px !important;
  margin: 0 !important;
  cursor: pointer !important;
}

.iirose-emoji-import-row-text {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  font-weight: bold !important;
}

.iirose-emoji-export-row {
  box-sizing: border-box !important;
  display: block !important;
  width: 100% !important;
  min-height: 44px !important;
  margin: 0 !important;
  padding: 8px 14px !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.6) !important;
  color: #333 !important;
  font-weight: bold !important;
  font-size: 16px !important;
  line-height: 22px !important;
  text-align: left !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  cursor: pointer !important;
}

.iirose-emoji-export-row:hover {
  background: rgba(255, 255, 255, 0.85) !important;
}

.iirose-emoji-dialog-footer {
  box-sizing: border-box !important;
  flex: 0 0 48px !important;
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  background: rgba(255, 255, 255, 0.86) !important;
}

.iirose-emoji-dialog-button {
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 18px !important;
  min-width: 0 !important;
  height: 48px !important;
  padding: 0 16px !important;
  border: 0 !important;
  border-radius: 0 !important;
  font-weight: bold !important;
  font-size: 20px !important;
  line-height: 28px !important;
  cursor: pointer !important;
}

.iirose-emoji-dialog-button .buttonIcon {
  font-family: md !important;
  font-size: 31px !important;
  line-height: 31px !important;
}

.iirose-emoji-dialog-button--cancel {
  background: rgba(255, 255, 255, 0.78) !important;
  color: #6589cc !important;
}

.iirose-emoji-dialog-button--confirm {
  background: #6589cc !important;
  color: rgba(255, 255, 255, 0.92) !important;
}

.iirose-emoji-dialog-button--danger {
  background: #b85c5c !important;
}

.iirose-emoji-dialog--shake .iirose-emoji-dialog-panel {
  animation: iiroseEmojiDialogShake 0.2s linear;
}

@keyframes iiroseEmojiDialogShake {
  0%, 100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}

@media (max-width: 520px) {
  #faceHolder .emojiContentBox[index="4"] .emojiPage .iirose-emoji-category-bar {
    gap: 8px !important;
    max-width: calc(100% - 36px) !important;
    padding: 0 6px !important;
  }

  .iirose-emoji-category-actions,
  .iirose-emoji-category-scroll {
    gap: 8px !important;
  }

  .iirose-emoji-category-button {
    max-width: 120px !important;
    height: 34px !important;
    padding: 0 14px !important;
    line-height: 32px !important;
    font-size: 15px !important;
  }

  .iirose-emoji-category-button--add {
    width: 38px !important;
    padding: 0 !important;
    font-size: 22px !important;
  }

  .iirose-emoji-category-button--more,
  .iirose-emoji-category-button--share {
    width: 54px !important;
    padding: 0 !important;
    line-height: 32px !important;
    font-size: 15px !important;
  }

  .iirose-emoji-category-picker {
    max-height: min(300px, calc(100vh - 80px)) !important;
  }

  .iirose-emoji-dialog-header {
    flex-basis: 48px !important;
    gap: 18px !important;
    padding: 0 18px !important;
  }

  .iirose-emoji-dialog-title {
    font-size: 21px !important;
  }

  .iirose-emoji-dialog-content {
    padding: 26px 22px !important;
  }

  .iirose-emoji-dialog-input {
    font-size: 19px !important;
  }

  .iirose-emoji-share-menu {
    padding: 12px !important;
  }

  .iirose-emoji-share-menu-panel {
    width: calc(100vw - 24px) !important;
    max-height: var(--iirose-emoji-share-menu-max-height, calc(100vh - 24px)) !important;
  }

  .iirose-emoji-share-menu-header {
    height: 64px !important;
    padding: 0 26px !important;
    font-size: 21px !important;
  }

  .iirose-emoji-share-menu-item {
    min-height: 76px !important;
    padding: 18px 26px 18px 86px !important;
    font-size: 21px !important;
    line-height: 30px !important;
  }

  .iirose-emoji-share-menu-icon {
    left: 28px !important;
    width: 36px !important;
    height: 36px !important;
    font-size: 30px !important;
    line-height: 36px !important;
  }

  .iirose-emoji-dialog--market .iirose-emoji-dialog-panel {
    width: calc(100vw - 20px) !important;
    height: min(78vh, calc(100vh - 20px)) !important;
  }

  .iirose-emoji-market-toolbar {
    align-items: flex-start !important;
    flex-direction: column !important;
  }

  .iirose-emoji-market-card {
    grid-template-columns: 96px minmax(0, 1fr) !important;
    gap: 12px !important;
    padding: 10px !important;
  }

  .iirose-emoji-market-cover {
    width: 96px !important;
    height: 96px !important;
  }

  .iirose-emoji-market-title {
    font-size: 16px !important;
    line-height: 23px !important;
  }

  .iirose-emoji-market-desc {
    font-size: 13px !important;
    line-height: 20px !important;
  }

  .iirose-emoji-dialog-textarea {
    min-height: 190px !important;
    padding: 16px !important;
    font-size: 14px !important;
    line-height: 22px !important;
  }

  .iirose-emoji-dialog-footer {
    flex-basis: 48px !important;
  }

  .iirose-emoji-dialog-button {
    height: 48px !important;
    font-size: 19px !important;
  }
}
`;
  }
})();
