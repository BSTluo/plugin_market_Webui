(function iiroseQQMenuScript() {
  'use strict';

  const INSTALL_VERSION = '2026-06-09.6';
  if (window.__iiroseQQMessageMenuInstalledVersion === INSTALL_VERSION) return;
  window.__iiroseQQMessageMenuInstalledVersion = INSTALL_VERSION;
  window.__iiroseQQMessageMenuInstalled = true;

  /**
   * iirose QQ style message menu
   *
   * 用法：
   * 1. 直接导入 iirose 的自定义 JS。
   */

  const CONFIG = {
    gap: 10,
    mobileGap: 4,
    viewportPadding: 8,
    mobileViewportPadding: 6,
    maxMenuWidth: 430,
    mobileMaxMenuWidth: 390,
    mobileItemWidth: 74,
    mobileColumnGap: 8,
    mobileMenuPaddingX: 14,
    triggerWindowMs: 1200,
  };

  const ACTION_WORDS = [
    '复制',
    '转发',
    '部分选中',
    '撤回',
    '多选',
    '引用',
    '收藏',
    '翻译',
    '提醒',
    '截图',
    '解析',
    '时间',
    '保存',
    '加入图包',
  ];

  const IIROSE_TEXT_MESSAGE_MENU_WORDS = ['引用', '解析', '翻译', '时间'];
  const IIROSE_IMAGE_MESSAGE_MENU_WORDS = ['引用', '解析', '时间', '保存', '加入图包'];
  const NON_MESSAGE_MENU_WORDS = [
    '查看资料',
    '私聊',
    '艾特',
    '电话',
    '消息菜单',
    '进入',
    '打开目录',
    '查看房间资料',
  ];
  const OVERRIDDEN_MENU_STYLE_PROPS = [
    'position',
    'min-width',
    'max-width',
    'max-height',
    'left',
    'top',
    'width',
  ];

  const MENU_SELECTORS = [
    '#selectHolderBox',
    // 拿到 iirose 真实 DOM 后，优先把菜单 class/id 写到这里。
    '.iirose-message-menu',
    '.message-menu',
    '.chat-menu',
    '.context-menu',
    '.contextMenu',
    '[role="menu"]',
  ];

  const MESSAGE_SELECTORS = [
    '.room_chat_content',
    '.chatContentHolder',
    '.publicMsgHasBubble',
    '.roomChatContentBox',
    // 拿到 iirose 真实 DOM 后，优先把消息气泡或消息项 class/id 写到这里。
    '.message',
    '.msg',
    '.chat-message',
    '.message-item',
    '.chat-item',
    '.bubble',
    '[data-message-id]',
    '[data-msg-id]',
    '[msgid]',
  ];
  const MESSAGE_CONTENT_SELECTORS = [
    '.chatContentHolder',
    '.publicMsgHasBubble',
    '.bgImgBox',
    'img',
  ];

  let lastTrigger = null;
  let activeMenu = null;
  let activeAnchor = null;
  let rafId = 0;
  const originalMenuStyles = new WeakMap();
  const actionClickBoundMenus = new WeakSet();
  const nativeBackdrops = new Set();

  installInSameOriginFrames();
  injectStyle();
  installTriggerCapture();
  installMenuObserver();
  window.addEventListener('resize', schedulePosition, true);
  window.addEventListener('scroll', schedulePosition, true);

  function installInSameOriginFrames() {
    const source = '(' + iiroseQQMenuScript.toString() + ')();';

    const install = (frame) => {
      try {
        const frameWindow = frame.contentWindow;
        const frameDocument = frame.contentDocument;
        if (
          !frameWindow ||
          !frameDocument ||
          frameWindow.__iiroseQQMessageMenuInstalledVersion === INSTALL_VERSION
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
    };

    scan();
    window.setInterval(scan, 1500);
  }

  function installTriggerCapture() {
    document.addEventListener(
      'contextmenu',
      (event) => {
        rememberTrigger(event.target, event.clientX, event.clientY, 'mouse');
        setTimeout(tryAttachMenu, 0);
        setTimeout(tryAttachMenu, 80);
      },
      true
    );

    document.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType === 'mouse' && event.button !== 2) return;
        rememberTrigger(event.target, event.clientX, event.clientY, event.pointerType || 'pointer');
      },
      true
    );

    document.addEventListener(
      'touchstart',
      (event) => {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        rememberTrigger(event.target, touch.clientX, touch.clientY, 'touch');
        setTimeout(tryAttachMenu, 380);
        setTimeout(tryAttachMenu, 700);
      },
      { capture: true, passive: true }
    );
  }

  function installMenuObserver() {
    const observer = new MutationObserver(() => {
      resetIfSelectHolderWasReused();
      scheduleAttach();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
  }

  function rememberTrigger(target, x, y, inputType) {
    const anchor = findStrictMessageAnchor(target, inputType, x, y);
    if (!anchor) {
      lastTrigger = null;
      activeAnchor = null;
      return;
    }

    lastTrigger = {
      target,
      x,
      y,
      inputType,
      time: Date.now(),
    };
    activeAnchor = anchor;
  }

  function scheduleAttach() {
    if (Date.now() - (lastTrigger && lastTrigger.time || 0) > CONFIG.triggerWindowMs) return;
    window.clearTimeout(scheduleAttach.timer);
    scheduleAttach.timer = window.setTimeout(tryAttachMenu, 30);
  }

  function tryAttachMenu() {
    if (!lastTrigger || Date.now() - lastTrigger.time > CONFIG.triggerWindowMs) return;

    const menu = findMenu();
    if (!menu) return;
    if (!isIiroseMessageActionMenu(menu)) {
      resetMenu(menu);
      return;
    }

    const anchor = activeAnchor || findStrictMessageAnchor(
      lastTrigger.target,
      lastTrigger.inputType,
      lastTrigger.x,
      lastTrigger.y
    );
    if (!anchor) return;

    activeMenu = menu;
    activeAnchor = anchor;
    decorateMenu(menu);
    neutralizeNativeBackdrop(menu);
    positionMenu(menu, anchor);
  }

  function findMenu() {
    for (const selector of MENU_SELECTORS) {
      const menu = Array.from(document.querySelectorAll(selector)).find(isVisibleElement);
      if (menu && looksLikeActionMenu(menu)) return menu;
    }

    return Array.from(document.body.querySelectorAll('*'))
      .filter(isVisibleElement)
      .filter(looksLikeFloatingLayer)
      .filter(looksLikeActionMenu)
      .sort((a, b) => scoreMenu(b) - scoreMenu(a))[0] || null;
  }

  function decorateMenu(menu) {
    if (menu.classList.contains('iirose-qq-message-menu')) return;
    rememberOriginalMenuStyle(menu);
    menu.classList.add('iirose-qq-message-menu');
    normalizeMenuItems(menu);
    bindActionReset(menu);
  }

  function bindActionReset(menu) {
    if (actionClickBoundMenus.has(menu)) return;
    actionClickBoundMenus.add(menu);

    menu.addEventListener(
      'click',
      (event) => {
        if (!menu.classList.contains('iirose-qq-message-menu')) return;
        if (!event.target.closest('.selectHolderBoxItem')) return;
        window.setTimeout(() => resetMenu(menu), 0);
      },
      true
    );
  }

  function rememberOriginalMenuStyle(menu) {
    if (originalMenuStyles.has(menu)) return;

    const styleState = OVERRIDDEN_MENU_STYLE_PROPS.map((prop) => ({
      prop,
      value: menu.style.getPropertyValue(prop),
      priority: menu.style.getPropertyPriority(prop),
    }));

    originalMenuStyles.set(menu, styleState);
  }

  function resetIfSelectHolderWasReused() {
    const menu = document.querySelector('#selectHolderBox.iirose-qq-message-menu');
    if (!menu) return;
    if (isIiroseMessageActionMenu(menu)) return;
    resetMenu(menu);
  }

  function resetMenu(menu) {
    if (!menu || !menu.classList || !menu.classList.contains('iirose-qq-message-menu')) return;

    restoreNativeBackdrops();
    document.documentElement.classList.remove('iirose-qq-message-menu-active');
    menu.classList.remove('iirose-qq-message-menu');
    menu.classList.remove('iirose-qq-message-menu__grid');
    menu.removeAttribute('data-iirose-placement');
    menu.style.removeProperty('--iirose-menu-arrow-left');
    menu.style.removeProperty('--iirose-menu-columns');

    const styleState = originalMenuStyles.get(menu);
    if (styleState) {
      styleState.forEach(({ prop, value, priority }) => {
        if (value) {
          menu.style.setProperty(prop, value, priority);
        } else {
          menu.style.removeProperty(prop);
        }
      });
      originalMenuStyles.delete(menu);
    }

    menu.querySelectorAll('.iirose-qq-message-menu__item').forEach((item) => {
      item.classList.remove('iirose-qq-message-menu__item');
    });

    menu.querySelectorAll('.iirose-qq-message-menu__grid').forEach((item) => {
      item.classList.remove('iirose-qq-message-menu__grid');
      item.style.removeProperty('--iirose-menu-columns');
    });

    if (activeMenu === menu) {
      activeMenu = null;
      activeAnchor = null;
    }
  }

  function normalizeMenuItems(menu) {
    const items = getMenuItems(menu);
    if (!items.length) return;

    const layoutParent = findLayoutParent(menu, items);
    layoutParent.classList.add('iirose-qq-message-menu__grid');
    layoutParent.style.setProperty('--iirose-menu-columns', getColumnCount(items.length));

    items.forEach((item) => {
      item.classList.add('iirose-qq-message-menu__item');
    });
  }

  function findLayoutParent(menu, items) {
    const parentCounts = new Map();

    items.forEach((item) => {
      let node = item.parentElement;
      while (node && node !== document.body) {
        if (node === menu || menu.contains(node)) {
          parentCounts.set(node, (parentCounts.get(node) || 0) + 1);
        }
        if (node === menu) break;
        node = node.parentElement;
      }
    });

    return Array.from(parentCounts.entries())
      .filter((entry) => entry[1] >= Math.min(2, items.length))
      .sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return getElementDepth(b[0]) - getElementDepth(a[0]);
      })[0]?.[0] || menu;
  }

  function getColumnCount(itemCount) {
    if (itemCount <= 3) return String(itemCount);
    if (itemCount <= 8) return String(4);
    return String(5);
  }

  function getElementDepth(element) {
    let depth = 0;
    let node = element;
    while (node && node !== document.body) {
      depth += 1;
      node = node.parentElement;
    }
    return depth;
  }

  function getMenuItems(menu) {
    const semanticItems = Array.from(
      menu.querySelectorAll('button, [role="menuitem"], li, a')
    ).filter((item) => item.textContent.trim());

    if (semanticItems.length) return semanticItems;

    const children = Array.from(menu.children).filter((item) => {
      const text = item.textContent.trim();
      return text && ACTION_WORDS.some((word) => text.includes(word));
    });

    if (children.length) return children;

    return [];
  }

  function positionMenu(menu, anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    if (!isUsableRect(anchorRect)) return;

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const mobile = isMobileMenu();
    const padding = mobile ? CONFIG.mobileViewportPadding : CONFIG.viewportPadding;
    const gap = mobile ? CONFIG.mobileGap : CONFIG.gap;
    const maxMenuWidth = mobile ? CONFIG.mobileMaxMenuWidth : CONFIG.maxMenuWidth;
    const positionAnchor = getPositionAnchor(anchorRect, mobile);

    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('min-width', '0', 'important');
    menu.style.setProperty('max-width', Math.min(maxMenuWidth, viewportWidth - padding * 2) + 'px', 'important');
    menu.style.setProperty('max-height', Math.max(80, viewportHeight - padding * 2) + 'px', 'important');
    menu.style.setProperty('left', padding + 'px', 'important');
    menu.style.setProperty('top', padding + 'px', 'important');

    const initialMenuRect = menu.getBoundingClientRect();
    const menuWidth = getTargetMenuWidth(menu, mobile, initialMenuRect, viewportWidth, padding, maxMenuWidth);
    menu.style.setProperty('width', menuWidth + 'px', 'important');

    const menuRect = menu.getBoundingClientRect();
    const menuHeight = menuRect.height || 80;
    const anchorCenterX = positionAnchor.centerX;

    let left = clamp(anchorCenterX - menuWidth / 2, padding, viewportWidth - menuWidth - padding);
    let top = positionAnchor.top - menuHeight - gap;
    let placement = 'top';

    if (top < padding) {
      top = positionAnchor.bottom + gap;
      placement = 'bottom';
    }

    top = clamp(top, padding, viewportHeight - menuHeight - padding);

    const correctedPosition = applyViewportPosition(menu, left, top);
    left = correctedPosition.left;
    top = correctedPosition.top;

    menu.style.setProperty('left', left + 'px', 'important');
    menu.style.setProperty('top', top + 'px', 'important');
    menu.dataset.iirosePlacement = placement;
    const finalRect = menu.getBoundingClientRect();
    const visibleLeft = isUsableRect(finalRect) ? finalRect.left : left;
    menu.style.setProperty('--iirose-menu-arrow-left', clamp(anchorCenterX - visibleLeft, 14, menuWidth - 14) + 'px');
  }

  function getTargetMenuWidth(menu, mobile, menuRect, viewportWidth, padding, maxMenuWidth) {
    const maxAvailableWidth = Math.min(maxMenuWidth, viewportWidth - padding * 2);
    if (!mobile) return Math.min(menuRect.width || maxMenuWidth, maxAvailableWidth);

    const itemCount = Math.max(1, getMenuItems(menu).length);
    const columns = Math.max(1, Math.min(parseInt(getColumnCount(itemCount), 10) || itemCount, itemCount));
    const idealWidth =
      columns * CONFIG.mobileItemWidth +
      Math.max(0, columns - 1) * CONFIG.mobileColumnGap +
      CONFIG.mobileMenuPaddingX * 2;

    return Math.min(idealWidth, maxAvailableWidth);
  }

  function getPositionAnchor(anchorRect, mobile) {
    const fallback = {
      top: anchorRect.top,
      bottom: anchorRect.bottom,
      centerX: anchorRect.left + anchorRect.width / 2,
    };

    if (!mobile || !lastTrigger) return fallback;

    const x = lastTrigger.x;
    const y = lastTrigger.y;
    const xInside = x >= anchorRect.left - 24 && x <= anchorRect.right + 24;
    const yInside = y >= anchorRect.top - 24 && y <= anchorRect.bottom + 24;
    const rectIsTall = anchorRect.height > 180;

    if (xInside && yInside && !rectIsTall) return fallback;

    return {
      top: y,
      bottom: y,
      centerX: xInside ? fallback.centerX : x,
    };
  }

  function applyViewportPosition(menu, viewportLeft, viewportTop) {
    menu.style.setProperty('left', viewportLeft + 'px', 'important');
    menu.style.setProperty('top', viewportTop + 'px', 'important');

    const actualRect = menu.getBoundingClientRect();
    if (!isUsableRect(actualRect)) {
      return { left: viewportLeft, top: viewportTop };
    }

    const correctedLeft = viewportLeft + (viewportLeft - actualRect.left);
    const correctedTop = viewportTop + (viewportTop - actualRect.top);
    if (Math.abs(correctedLeft - viewportLeft) < 0.5 && Math.abs(correctedTop - viewportTop) < 0.5) {
      return { left: viewportLeft, top: viewportTop };
    }

    return {
      left: correctedLeft,
      top: correctedTop,
    };
  }

  function schedulePosition() {
    if (!activeMenu || !activeAnchor || !document.documentElement.contains(activeMenu)) return;
    window.cancelAnimationFrame(rafId);
    rafId = window.requestAnimationFrame(() => positionMenu(activeMenu, activeAnchor));
  }

  function findMessageAnchor(target, x, y) {
    const explicit = closestBySelectors(target, MESSAGE_SELECTORS);
    if (explicit && isVisibleElement(explicit)) return explicit;

    const path = getElementPath(target);
    let best = null;
    let bestScore = -Infinity;

    for (const element of path) {
      const rect = element.getBoundingClientRect();
      if (!isUsableRect(rect)) continue;
      if (rect.width > window.innerWidth * 0.95) continue;
      if (rect.height > window.innerHeight * 0.55) continue;

      const score = scoreAnchor(element, rect, x, y);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    return best;
  }

  function findStrictMessageAnchor(target, inputType, x, y) {
    if (!target || target.nodeType !== 1) return null;
    const message = target.closest('.room_chat_content');
    if (!message) return null;
    if (!isTouchInput(inputType) && !isMobileViewport()) return message;
    return findMessageContentAnchor(target, message, x, y) || message;
  }

  function findMessageContentAnchor(target, message, x, y) {
    const direct = closestBySelectors(target, MESSAGE_CONTENT_SELECTORS);
    if (direct && message.contains(direct) && isVisibleElement(direct)) return direct;

    const candidates = Array.from(message.querySelectorAll(MESSAGE_CONTENT_SELECTORS.join(',')))
      .filter(isVisibleElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 16 && rect.height >= 16;
      })
      .sort((a, b) => scoreContentAnchor(b, target, x, y) - scoreContentAnchor(a, target, x, y));

    return candidates[0] || null;
  }

  function scoreContentAnchor(element, target, x, y) {
    const rect = element.getBoundingClientRect();
    const triggerX = Number.isFinite(x) ? x : rect.left + rect.width / 2;
    const triggerY = Number.isFinite(y) ? y : rect.top + rect.height / 2;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let score = 0;

    if (element === target || element.contains(target)) score += 20;
    if (element.classList.contains('chatContentHolder')) score += 12;
    if (element.classList.contains('publicMsgHasBubble')) score += 8;
    if (element.tagName === 'IMG') score += 6;
    score -= Math.abs(centerX - triggerX) / 30;
    score -= Math.abs(centerY - triggerY) / 30;
    return score;
  }

  function scoreAnchor(element, rect, x, y) {
    const style = getComputedStyle(element);
    const radius = parseFloat(style.borderRadius) || 0;
    const background = style.backgroundColor || '';
    const text = element.textContent.trim();
    const area = rect.width * rect.height;

    let score = 0;
    if (hasVisibleBackground(background)) score += 8;
    if (radius >= 6) score += 5;
    if (rect.width >= 36 && rect.width <= 520) score += 3;
    if (rect.height >= 20 && rect.height <= 220) score += 3;
    if (text && text.length <= 600) score += 2;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) score += 2;
    score -= area / 100000;
    return score;
  }

  function closestBySelectors(target, selectors) {
    if (!target || target.nodeType !== 1) return null;

    for (const selector of selectors) {
      try {
        const matched = target.closest(selector);
        if (matched) return matched;
      } catch (error) {
        // Ignore invalid user-edited selectors.
      }
    }

    return null;
  }

  function getElementPath(target) {
    const path = [];
    let node = target && (target.nodeType === 1 ? target : target.parentElement);

    while (node && node !== document.body && path.length < 14) {
      path.push(node);
      node = node.parentElement;
    }

    return path;
  }

  function looksLikeFloatingLayer(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const zIndex = parseInt(style.zIndex, 10);

    if (style.position !== 'fixed' && style.position !== 'absolute') return false;
    if (Number.isFinite(zIndex) && zIndex < 10) return false;
    if (rect.width < 40 || rect.height < 26) return false;
    if (rect.width > window.innerWidth * 0.98 || rect.height > window.innerHeight * 0.75) return false;

    return true;
  }

  function looksLikeActionMenu(element) {
    if (element.classList.contains('iirose-qq-message-menu')) return true;

    const text = element.textContent.replace(/\s+/g, '');
    if (!text) return false;

    const hits = ACTION_WORDS.filter((word) => text.includes(word)).length;
    return hits >= 1;
  }

  function isIiroseMessageActionMenu(menu) {
    const text = menu.textContent.replace(/\s+/g, '');
    const isTextMessageMenu = IIROSE_TEXT_MESSAGE_MENU_WORDS.every((word) => text.includes(word));
    const isImageMessageMenu = IIROSE_IMAGE_MESSAGE_MENU_WORDS.every((word) => text.includes(word));
    if (!isTextMessageMenu && !isImageMessageMenu) return false;
    return !NON_MESSAGE_MENU_WORDS.some((word) => text.includes(word));
  }

  function scoreMenu(element) {
    const rect = element.getBoundingClientRect();
    const text = element.textContent.replace(/\s+/g, '');
    const hits = ACTION_WORDS.filter((word) => text.includes(word)).length;
    let score = hits * 10;
    score -= Math.abs(rect.left - (lastTrigger ? lastTrigger.x : rect.left)) / 120;
    score -= Math.abs(rect.top - (lastTrigger ? lastTrigger.y : rect.top)) / 120;
    return score;
  }

  function isVisibleElement(element) {
    if (!element || element.nodeType !== 1) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    return isUsableRect(element.getBoundingClientRect());
  }

  function isUsableRect(rect) {
    return rect && rect.width > 0 && rect.height > 0;
  }

  function hasVisibleBackground(value) {
    if (!value || value === 'transparent') return false;
    const rgba = value.match(/rgba?\(([^)]+)\)/);
    if (!rgba) return true;
    const parts = rgba[1].split(',').map((part) => part.trim());
    if (parts.length < 4) return true;
    return Number(parts[3]) > 0.05;
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }

  function isTouchInput(inputType) {
    return inputType === 'touch' || inputType === 'pen';
  }

  function isMobileMenu() {
    return isTouchInput(lastTrigger && lastTrigger.inputType) || isMobileViewport();
  }

  function isMobileViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 520px), (pointer: coarse)').matches;
  }

  function neutralizeNativeBackdrop(menu) {
    if (!isMobileMenu()) return;
    document.documentElement.classList.add('iirose-qq-message-menu-active');

    Array.from(document.body.querySelectorAll('*')).forEach((element) => {
      if (element === menu || menu.contains(element) || element.contains(menu)) return;
      if (element.classList.contains('iirose-qq-message-menu__native-backdrop')) return;
      if (!looksLikeNativeBackdrop(element)) return;
      element.classList.add('iirose-qq-message-menu__native-backdrop');
      nativeBackdrops.add(element);
    });
  }

  function restoreNativeBackdrops() {
    nativeBackdrops.forEach((element) => {
      if (element.classList) element.classList.remove('iirose-qq-message-menu__native-backdrop');
    });
    nativeBackdrops.clear();
  }

  function looksLikeNativeBackdrop(element) {
    if (!isVisibleElement(element)) return false;

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const coversViewport =
      rect.left <= 4 &&
      rect.top <= 4 &&
      rect.width >= viewportWidth * 0.92 &&
      rect.height >= viewportHeight * 0.92;

    if (!coversViewport) return false;
    if (style.position !== 'fixed' && style.position !== 'absolute') return false;
    if (element.textContent.trim()) return false;

    return (
      hasVisibleBackground(style.backgroundColor) ||
      (style.backdropFilter && style.backdropFilter !== 'none') ||
      (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none') ||
      Number(style.opacity) < 1
    );
  }

  function injectStyle() {
    if (document.getElementById('iirose-qq-message-menu-style')) return;

    const style = document.createElement('style');
    style.id = 'iirose-qq-message-menu-style';
    style.textContent = `
.iirose-qq-message-menu {
  box-sizing: border-box !important;
  z-index: 2147483647 !important;
  border-radius: 10px !important;
  padding: 10px 14px !important;
  min-width: 0 !important;
  background: rgba(64, 64, 64, 0.94) !important;
  color: #fff !important;
  border: 0 !important;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22) !important;
  transform: none !important;
  overflow: visible !important;
  scrollbar-width: none !important;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.iirose-qq-message-menu::-webkit-scrollbar {
  display: none !important;
}

.iirose-qq-message-menu__grid {
  display: grid !important;
  grid-template-columns: repeat(var(--iirose-menu-columns, 5), minmax(48px, 1fr)) !important;
  gap: 8px 6px !important;
  align-items: center !important;
  justify-items: stretch !important;
}

.iirose-qq-message-menu::after {
  content: "";
  position: absolute;
  left: var(--iirose-menu-arrow-left, 50%);
  width: 14px;
  height: 14px;
  background: rgba(64, 64, 64, 0.94);
  transform: translateX(-50%) rotate(45deg);
}

.iirose-qq-message-menu[data-iirose-placement="top"]::after {
  bottom: -6px;
}

.iirose-qq-message-menu[data-iirose-placement="bottom"]::after {
  top: -6px;
}

.iirose-qq-message-menu__item,
.iirose-qq-message-menu .selectHolderBoxItem,
.iirose-qq-message-menu button,
.iirose-qq-message-menu [role="menuitem"],
.iirose-qq-message-menu li,
.iirose-qq-message-menu a {
  box-sizing: border-box !important;
  color: #fff !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 6px !important;
  width: 64px !important;
  min-width: 56px !important;
  height: 56px !important;
  min-height: 48px !important;
  padding: 6px 8px !important;
  font-size: 14px !important;
  line-height: 1.2 !important;
  text-align: center !important;
  cursor: pointer !important;
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px !important;
  overflow: hidden !important;
}

.iirose-qq-message-menu__item:hover,
.iirose-qq-message-menu .selectHolderBoxItem:hover,
.iirose-qq-message-menu button:hover,
.iirose-qq-message-menu [role="menuitem"]:hover,
.iirose-qq-message-menu li:hover,
.iirose-qq-message-menu a:hover {
  background: rgba(255, 255, 255, 0.1) !important;
}

.iirose-qq-message-menu .selectHolderBoxItemIcon > div:first-child,
.iirose-qq-message-menu .selectHolderBoxItemIcon > [class^="mdi-"],
.iirose-qq-message-menu .selectHolderBoxItemIcon > [class*=" mdi-"] {
  position: static !important;
  width: 24px !important;
  height: 24px !important;
  line-height: 24px !important;
  font-size: 24px !important;
  text-align: center !important;
  opacity: 0.95 !important;
  color: #fff !important;
  pointer-events: none !important;
}

.iirose-qq-message-menu .fullBox {
  inset: 0 !important;
}

.iirose-qq-message-menu__native-backdrop {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  opacity: 1 !important;
}

@media (max-width: 520px) {
  .iirose-qq-message-menu {
    border-radius: 12px !important;
    padding: 12px 14px !important;
  }

  .iirose-qq-message-menu__grid {
    grid-template-columns: repeat(var(--iirose-menu-columns, 4), minmax(0, 1fr)) !important;
    gap: 10px 8px !important;
  }

  .iirose-qq-message-menu__item,
  .iirose-qq-message-menu .selectHolderBoxItem,
  .iirose-qq-message-menu button,
  .iirose-qq-message-menu [role="menuitem"],
  .iirose-qq-message-menu li,
  .iirose-qq-message-menu a {
    width: 100% !important;
    min-width: 0 !important;
    height: 70px !important;
    min-height: 66px !important;
    padding: 7px 8px !important;
    font-size: 16px !important;
    gap: 6px !important;
  }

  .iirose-qq-message-menu .selectHolderBoxItemIcon > div:first-child,
  .iirose-qq-message-menu .selectHolderBoxItemIcon > [class^="mdi-"],
  .iirose-qq-message-menu .selectHolderBoxItemIcon > [class*=" mdi-"] {
    width: 32px !important;
    height: 32px !important;
    line-height: 32px !important;
    font-size: 32px !important;
  }
}
`;

    document.head.appendChild(style);
  }
})();
