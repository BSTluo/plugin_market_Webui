// ==UserScript==
// @name         iirose 五子棋测试版
// @namespace    iirose-game
// @version      0.0.9
// @description  借用 iirose WebSocket 通道，在同房间安装了脚本的用户之间下五子棋（娱乐测试版，不防作弊）
// @match        *://*.iirose.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ===================================================================
  // 常量与协议
  // ===================================================================
  const PROTO_NS = 'iirose_game';
  const PROTO_VER = 'v1';
  const GAME = 'gomoku';
  const SOCIAL = 'social';
  const BOARD = 15; // 15x15
  const FRIENDS_KEY = 'iiroseGameFriends';

  // 协议外壳：#~iirose_game|v1|gomoku|ACTION|ENCODED_JSON~#
  // ENCODED_JSON = encodeURIComponent(JSON.stringify(payload))
  const PROTO_SUFFIX = '~#';
  // 用来在一条聊天文本里识别本协议片段
  const PROTO_REGEX = new RegExp(
    `#~${PROTO_NS}\\|${PROTO_VER}\\|(${GAME}|${SOCIAL})\\|([a-z_]+)\\|([^~]*)~#`,
    'i'
  );

  const DEBUG = true; // 打印每条收发，便于双端实测
  const DEBUG_RAW = true; // 临时：打印含本协议的原始消息，便于确认私聊消息格式
  const LOG_PREFIX = '[gomoku]';
  function log(...args) {
    if (DEBUG) console.log(LOG_PREFIX, ...args);
  }

  // ===================================================================
  // 找到真正持有 socket / uid 的窗口（兼容 #mainFrame iframe）
  // ===================================================================
  function getIIROSEWindow() {
    try {
      if (window.socket && window.uid) return window;
    } catch (e) {}
    try {
      const iframe = document.getElementById('mainFrame');
      if (
        iframe &&
        iframe.contentWindow &&
        iframe.contentWindow.socket &&
        iframe.contentWindow.uid
      ) {
        return iframe.contentWindow;
      }
    } catch (e) {}
    return null;
  }

  function getSelfUid(win) {
    try {
      return String(win.uid || '');
    } catch (e) {
      return '';
    }
  }

  function getSelfName(win) {
    // 昵称仅用于展示，取不到不影响功能
    try {
      const globalName = win.myName || win.uname || win.username || win.name || '';
      if (globalName) return String(globalName).trim();
      const fromDom = findSelfNameInWindow(win) || findSelfNameInWindow(window);
      return fromDom ? fromDom.trim() : '';
    } catch (e) {
      return '';
    }
  }

  function findSelfNameInWindow(win) {
    try {
      if (!win || !win.document) return '';
      const el = win.document.getElementById('functionHolderInfoName');
      if (el && el.textContent) return String(el.textContent);
    } catch (e) {}
    return '';
  }

  function getSelfColorHex(win) {
    try {
      return win.inputcolorhex || '#ff9800';
    } catch (e) {
      return '#ff9800';
    }
  }

  // ===================================================================
  // 发送
  //   公屏广播：socket.send(JSON.stringify({ m, mc, i }))   —— 不能带 g
  //   私发给某人：socket.send(JSON.stringify({ g: 目标uid, m, mc, i }))
  //     g:自己uid = 私发给自己(同账号多设备)；g:对手uid = 私发给对手，
  //     不广播房间 → 不会污染没装插件的人的公屏。
  //   >256 字节的消息网站会自动 gzip，无需我们处理。
  // ===================================================================
  function rawSend(win, messageText) {
    try {
      win.socket.send(
        JSON.stringify({
          m: messageText,
          mc: getSelfColorHex(win),
          i: Date.now().toString().slice(-5) + Math.random().toString().slice(-7),
        })
      );
      return true;
    } catch (e) {
      log('rawSend 失败', e);
      return false;
    }
  }

  function rawSendPrivate(win, messageText, toUid) {
    if (!toUid) return rawSend(win, messageText); // 没有目标就退化为广播
    try {
      win.socket.send(
        JSON.stringify({
          g: toUid,
          m: messageText,
          mc: getSelfColorHex(win),
          i: Date.now().toString().slice(-5) + Math.random().toString().slice(-7),
        })
      );
      return true;
    } catch (e) {
      log('rawSendPrivate 失败', e);
      return false;
    }
  }

  function sendRoomNotice(messageText) {
    const win = state.win;
    if (!win || !messageText) return false;
    log('SEND notice 公屏', messageText);
    return rawSend(win, messageText);
  }

  function buildProtoMessage(scope, action, payload) {
    return `#~${PROTO_NS}|${PROTO_VER}|${scope}|${action}|` +
      encodeURIComponent(JSON.stringify(payload)) + PROTO_SUFFIX;
  }

  // toUid 为空 = 公屏广播（仅 invite 用）；否则私发给该 uid（对局过程全部私发）
  function sendGame(action, payload, toUid) {
    return sendProto(GAME, action, payload, toUid, true);
  }

  function sendSocial(action, payload, toUid) {
    return sendProto(SOCIAL, action, payload, toUid, false);
  }

  function sendProto(scope, action, payload, toUid, includeGameId) {
    const win = state.win;
    if (!win) {
      toast('未找到 iirose 连接，无法发送');
      return false;
    }
    const selfUid = getSelfUid(win);
    const selfName = getSelfName(win);
    rememberName(selfUid, selfName);
    const full = Object.assign(
      {
        fromUid: selfUid,
        fromName: selfName,
        ts: Date.now(),
      },
      payload
    );
    if (includeGameId && !Object.prototype.hasOwnProperty.call(full, 'gameId')) {
      full.gameId = state.gameId || null;
    }
    const text = buildProtoMessage(scope, action, full);
    log('SEND', scope, action, toUid ? '私发→' + toUid : '公屏', full);
    return toUid ? rawSendPrivate(win, text, toUid) : rawSend(win, text);
  }

  // ===================================================================
  // 接收：包裹 socket._onmessage，识别并过滤本协议
  //   公屏消息格式： '"' + 记录1 + '<' + 记录2 + ...
  //   私聊消息格式： '""' + 记录
  //   两者字段顺序不同，所以逐字段扫描协议正文，再按命中位置推断 sender uid。
  // ===================================================================
  function installInterceptor(win) {
    if (!win || !win.socket) return false;
    if (win.__iiroseGomokuInstalled) return true;

    const orig = win.socket._onmessage;
    win.socket._onmessage = function (msg) {
      try {
        const filtered = handleIncoming(msg);
        if (filtered === null) return; // 整条都是游戏指令，丢弃，不交给原站
        if (orig) return orig.call(win.socket, filtered);
      } catch (e) {
        log('拦截处理异常', e);
        if (orig) return orig.call(win.socket, msg);
      }
    };

    win.__iiroseGomokuInstalled = true;
    log('已安装消息拦截');
    return true;
  }

  // 返回：处理后应继续交给原站的消息文本；或 null 表示整条吞掉
  function handleIncoming(msg) {
    if (typeof msg !== 'string') return msg;
    if (DEBUG_RAW && msg.indexOf(PROTO_NS) >= 0) log('RAW', msg);

    // 站内聊天消息以 '"' 开头；公屏和私聊字段顺序不同，统一扫描协议字段。
    if (msg[0] === '"') {
      const records = msg.slice(1).split('<');
      const keep = [];
      let hadGame = false;
      for (const rec of records) {
        const fields = rec.split('>');
        const proto = findProtoInFields(fields);
        if (proto) {
          hadGame = true;
          dispatchRecord(fields, proto);
        } else {
          keep.push(rec);
        }
      }
      if (!hadGame) return msg; // 没有游戏指令，原样放行
      if (keep.length === 0) return null; // 全是游戏指令，吞掉
      return '"' + keep.join('<'); // 保留普通聊天，重新拼回
    }

    // 非公屏（含私聊）：若含本协议则处理并吞掉，否则放行
    if (PROTO_REGEX.test(msg)) {
      extractAndDispatch(msg);
      return null;
    }
    return msg;
  }

  function extractAndDispatch(text) {
    const m = text.match(PROTO_REGEX);
    if (!m) return;
    dispatchProto(m[1], m[2], m[3], null, '', '');
  }

  function findProtoInFields(fields) {
    for (let i = 0; i < fields.length; i++) {
      const text = fields[i] || '';
      const m = text.match(PROTO_REGEX);
      if (m) return { index: i, match: m };
    }
    return null;
  }

  function getSenderUidFromRecord(fields, protoIndex) {
    // 公屏：ts > avatar > nick > body > ... > uid
    if (protoIndex === 3) return fields[8] || '';
    // 私聊：ts > senderUid > nick > avatar > body > ...
    if (protoIndex === 4) return fields[1] || '';
    return '';
  }

  function getSenderNameFromRecord(fields, protoIndex) {
    // 公屏和私聊的昵称都在 fields[2]
    if (protoIndex === 3 || protoIndex === 4) return fields[2] || '';
    return '';
  }

  function getSenderAvatarFromRecord(fields, protoIndex) {
    // 公屏：ts > avatar > nick > body；私聊：ts > senderUid > nick > avatar > body
    if (protoIndex === 3) return fields[1] || '';
    if (protoIndex === 4) return fields[3] || '';
    return '';
  }

  function dispatchRecord(fields, proto) {
    const senderUid = getSenderUidFromRecord(fields, proto.index);
    const senderName = getSenderNameFromRecord(fields, proto.index);
    const senderAvatar = getSenderAvatarFromRecord(fields, proto.index);
    const m = proto.match;
    if (!m) return;
    dispatchProto(m[1], m[2], m[3], senderUid, senderName, senderAvatar);
  }

  function dispatchProto(scope, action, encoded, senderUid, senderName, senderAvatar) {
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(encoded));
    } catch (e) {
      log('payload 解析失败', scope, action, e);
      return;
    }
    // 消息包里的 uid / 昵称比 payload 更可信；payload 作为兜底。
    if (senderUid) payload._senderUid = senderUid;
    if (senderName) payload._senderName = senderName;
    if (senderAvatar) payload._senderAvatar = senderAvatar;
    rememberName(payload._senderUid || payload.fromUid, payload._senderName || payload.fromName);
    log('RECV', scope, action, payload);
    if (scope === SOCIAL) return onSocialMessage(action, payload);
    onGameMessage(action, payload);
  }

  // ===================================================================
  // 对局状态
  // ===================================================================
  const state = {
    win: null,
    myUid: '',
    myName: '',
    phase: 'idle', // idle | inviting | pending_accept | playing | finished
    gameId: null,
    watchCode: '',
    blackUid: null,
    whiteUid: null,
    myColor: null, // 'black' | 'white' | 'watcher'
    moves: [], // [{x,y,color}]
    board: null, // BOARD x BOARD，值 null/'black'/'white'
    winner: null, // null | 'black' | 'white' | 'draw'
    inviteFrom: null, // {uid,name,gameId}
    nameByUid: Object.create(null),
    knownGames: Object.create(null),
    watchers: Object.create(null),
    endNoticeSent: false,
    inviteMode: 'public', // public | friend
    publicWatch: false,
    friends: Object.create(null),
    showFriends: false,
    ignoredWatchGames: Object.create(null),
  };

  function cleanName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function rememberName(uid, name) {
    uid = String(uid || '');
    name = cleanName(name);
    if (!uid || !name) return;
    state.nameByUid[uid] = name;
    if (uid === state.myUid) state.myName = name;
  }

  function displayName(uid, fallback) {
    uid = String(uid || '');
    const name = cleanName(fallback) || state.nameByUid[uid] || '';
    return name || uid || '对方';
  }

  function cleanUid(uid) {
    return String(uid || '').replace(/[^0-9a-zA-Z]/g, '').trim();
  }

  function extractRoseUid(text) {
    const raw = String(text || '');
    const bracket = raw.match(/\[@([0-9a-zA-Z]+)@\]/);
    if (bracket) return cleanUid(bracket[1]);
    const parts = raw.match(/[0-9a-zA-Z]+/g) || [];
    let best = '';
    for (const part of parts) {
      if (part.length > best.length) best = part;
    }
    return best.length >= 6 ? cleanUid(best) : '';
  }

  function loadFriends() {
    state.friends = Object.create(null);
    try {
      const raw = localStorage.getItem(FRIENDS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const friends = data && data.friends ? data.friends : {};
      for (const uid of Object.keys(friends)) {
        const item = friends[uid] || {};
        const clean = cleanUid(item.uid || uid);
        if (!clean) continue;
        state.friends[clean] = {
          uid: clean,
          name: cleanName(item.name) || clean,
          avatar: String(item.avatar || ''),
          addedAt: Number(item.addedAt) || Date.now(),
          updatedAt: Number(item.updatedAt) || Date.now(),
        };
        rememberName(clean, state.friends[clean].name);
      }
    } catch (e) {
      log('好友列表读取失败', e);
    }
  }

  function saveFriends() {
    try {
      localStorage.setItem(FRIENDS_KEY, JSON.stringify({
        version: 1,
        friends: state.friends,
      }));
    } catch (e) {
      log('好友列表保存失败', e);
    }
  }

  function upsertFriend(uid, data) {
    uid = cleanUid(uid);
    if (!uid || uid === state.myUid) return null;
    const now = Date.now();
    const old = state.friends[uid] || {};
    const item = {
      uid,
      name: cleanName(data && data.name) || old.name || uid,
      avatar: String((data && data.avatar) || old.avatar || ''),
      addedAt: old.addedAt || now,
      updatedAt: now,
    };
    state.friends[uid] = item;
    rememberName(uid, item.name);
    saveFriends();
    renderFriends();
    return item;
  }

  function removeFriend(uid) {
    uid = cleanUid(uid);
    if (!uid || !state.friends[uid]) return;
    delete state.friends[uid];
    saveFriends();
    renderFriends();
  }

  function isFriend(uid) {
    return !!state.friends[cleanUid(uid)];
  }

  function friendList() {
    return Object.keys(state.friends)
      .map((uid) => state.friends[uid])
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function watchCodeFromGameId(gameId) {
    const parts = String(gameId || '').split('_');
    return (parts[parts.length - 1] || '').toLowerCase();
  }

  function isWatcher() {
    return state.myColor === 'watcher';
  }

  function isPlayer() {
    return state.myColor === 'black' || state.myColor === 'white';
  }

  function rememberKnownGame(gameId, blackUid, blackName) {
    const watchCode = watchCodeFromGameId(gameId);
    if (!watchCode) return;
    state.knownGames[watchCode] = {
      gameId,
      blackUid,
      blackName: cleanName(blackName) || displayName(blackUid),
      ts: Date.now(),
    };
  }

  function buildStartNotice() {
    const blackName = displayName(state.blackUid, state.blackUid === state.myUid ? state.myName : '');
    const whiteName = displayName(state.whiteUid, state.whiteUid === state.myUid ? state.myName : '');
    return `[五子棋] ${blackName} 和 ${whiteName} 开始对局，${blackName} 执黑，${whiteName} 执白。观战码：${state.watchCode}`;
  }

  function buildEndNotice() {
    const blackName = displayName(state.blackUid, state.blackUid === state.myUid ? state.myName : '');
    const whiteName = displayName(state.whiteUid, state.whiteUid === state.myUid ? state.myName : '');
    return `[五子棋] ${blackName} 和 ${whiteName} 的对局已结束。`;
  }

  function announceEndIfOwner() {
    if (state.phase !== 'finished') return;
    if (state.endNoticeSent) return;
    if (state.inviteMode !== 'public') return;
    // 只由执黑方发公告，避免双方重复发送。
    if (!state.blackUid || state.blackUid !== state.myUid) return;
    state.endNoticeSent = true;
    sendRoomNotice(buildEndNotice());
  }

  function buildStatePayload() {
    return {
      gameId: state.gameId,
      watchCode: state.watchCode,
      blackUid: state.blackUid,
      whiteUid: state.whiteUid,
      blackName: displayName(state.blackUid, state.blackUid === state.myUid ? state.myName : ''),
      whiteName: displayName(state.whiteUid, state.whiteUid === state.myUid ? state.myName : ''),
      inviteMode: state.inviteMode,
      publicWatch: state.publicWatch,
      boardSize: BOARD,
      moves: state.moves,
      status: state.phase,
      winner: state.winner,
    };
  }

  function sendWatchState(toUid) {
    if (!toUid || !state.gameId) return;
    sendGame('watch_state', buildStatePayload(), toUid);
  }

  function notifyWatchers() {
    if (!state.publicWatch) return;
    if (state.blackUid !== state.myUid) return;
    for (const uid of Object.keys(state.watchers)) {
      sendWatchState(uid);
    }
  }

  function newBoard() {
    return Array.from({ length: BOARD }, () => new Array(BOARD).fill(null));
  }

  function genGameId() {
    return 'gomoku_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function colorForSeq(seq) {
    // seq 从 1 开始，奇数=黑，偶数=白
    return seq % 2 === 1 ? 'black' : 'white';
  }

  function nextColor() {
    return colorForSeq(state.moves.length + 1);
  }

  function isMyTurn() {
    return state.phase === 'playing' && nextColor() === state.myColor;
  }

  function latestKnownWatchCode() {
    let best = null;
    for (const code of Object.keys(state.knownGames)) {
      const item = state.knownGames[code];
      if (!best || item.ts > best.ts) best = { code, ts: item.ts };
    }
    return best ? best.code : '';
  }

  function unignoreWatchCode(watchCode) {
    watchCode = cleanName(watchCode).toLowerCase();
    if (!watchCode) return;
    for (const gameId of Object.keys(state.ignoredWatchGames)) {
      if (watchCodeFromGameId(gameId) === watchCode) {
        delete state.ignoredWatchGames[gameId];
      }
    }
  }

  // 当前对手 uid（私发目标）
  function opponentUid() {
    if (state.myColor === 'black') return state.whiteUid;
    if (state.myColor === 'white') return state.blackUid;
    return null;
  }

  // ===================================================================
  // 落子与胜负
  // ===================================================================
  function applyMove(x, y, color) {
    state.board[y][x] = color;
    state.moves.push({ x, y, color });
    if (checkWin(x, y, color)) {
      state.winner = color;
      state.phase = 'finished';
    } else if (state.moves.length >= BOARD * BOARD) {
      state.winner = 'draw';
      state.phase = 'finished';
    }
    renderBoard();
    renderInfo();
  }

  const DIRS = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  function checkWin(x, y, color) {
    for (const [dx, dy] of DIRS) {
      let count = 1;
      for (let s = 1; s < 5; s++) {
        const nx = x + dx * s, ny = y + dy * s;
        if (nx < 0 || ny < 0 || nx >= BOARD || ny >= BOARD || state.board[ny][nx] !== color) break;
        count++;
      }
      for (let s = 1; s < 5; s++) {
        const nx = x - dx * s, ny = y - dy * s;
        if (nx < 0 || ny < 0 || nx >= BOARD || ny >= BOARD || state.board[ny][nx] !== color) break;
        count++;
      }
      if (count >= 5) return true;
    }
    return false;
  }

  // 本地点击落子
  function tryLocalMove(x, y) {
    if (state.phase !== 'playing') return;
    if (isWatcher()) {
      toast('观战中不能落子');
      return;
    }
    if (!isMyTurn()) {
      toast('还没轮到你');
      return;
    }
    if (state.board[y][x]) return;
    const seq = state.moves.length + 1;
    const color = state.myColor;
    applyMove(x, y, color); // 先本地落子
    // 私发给对手；若丢失，由对方下一手的 seq 缺口触发 sync_req 兜底
    sendGame('move', { seq, color, x, y }, opponentUid());
    announceEndIfOwner();
    notifyWatchers();
  }

  // ===================================================================
  // 协议消息处理
  // ===================================================================
  function onSocialMessage(action, p) {
    const senderUid = p._senderUid || p.fromUid;
    const senderName = displayName(senderUid, p._senderName || p.fromName);
    const senderAvatar = p._senderAvatar || p.avatar || '';
    rememberName(senderUid, senderName);

    switch (action) {
      case 'friend_req':
        return onFriendReq(p, senderUid, senderName, senderAvatar);
      case 'friend_accept':
        return onFriendAccept(p, senderUid, senderName, senderAvatar);
      default:
        log('未知 social action', action);
    }
  }

  function onFriendReq(p, senderUid, senderName, senderAvatar) {
    if (!senderUid || senderUid === state.myUid) return;
    if (isFriend(senderUid)) {
      upsertFriend(senderUid, { name: senderName, avatar: senderAvatar });
      sendSocial('friend_accept', { avatar: '' }, senderUid);
      return;
    }
    openPanel();
    const ok = window.confirm
      ? window.confirm(`${senderName} 请求添加为五子棋好友，是否同意？`)
      : true;
    if (!ok) return;
    upsertFriend(senderUid, { name: senderName, avatar: senderAvatar });
    sendSocial('friend_accept', { avatar: '' }, senderUid);
    toast(`已添加好友：${senderName}`);
  }

  function onFriendAccept(p, senderUid, senderName, senderAvatar) {
    if (!senderUid || senderUid === state.myUid) return;
    upsertFriend(senderUid, { name: senderName, avatar: senderAvatar });
    openPanel();
    toast(`${senderName} 已同意好友申请`);
  }

  function onGameMessage(action, p) {
    const senderUid = p._senderUid || p.fromUid;
    rememberName(senderUid, p._senderName || p.fromName);

    switch (action) {
      case 'invite':
        return onInvite(p, senderUid);
      case 'accept':
        return onAccept(p, senderUid);
      case 'reject':
        return onReject(p, senderUid);
      case 'start':
        return onStart(p, senderUid);
      case 'move':
        return onMove(p, senderUid);
      case 'resign':
        return onResign(p, senderUid);
      case 'sync_req':
        return onSyncReq(p, senderUid);
      case 'sync_state':
        return onSyncState(p, senderUid);
      case 'watch_req':
        return onWatchReq(p, senderUid);
      case 'watch_state':
        return onWatchState(p, senderUid);
      case 'watch_leave':
        return onWatchLeave(p, senderUid);
      case 'close':
        return onRemoteClose(p, senderUid);
      default:
        log('未知 action', action);
    }
  }

  function onInvite(p, senderUid) {
    // 忽略自己发出的邀请回显（invite 走公屏，会回显给自己）
    if (senderUid === state.myUid) return;
    if (p.toUid && cleanUid(p.toUid) !== state.myUid) return;
    if (state.phase !== 'idle' && state.phase !== 'finished') return; // 正在对局，忽略
    const inviterName = displayName(senderUid, p._senderName || p.fromName);
    const inviteMode = p.inviteMode === 'friend' ? 'friend' : 'public';
    if (inviteMode === 'public') rememberKnownGame(p.gameId, senderUid, inviterName);
    if (inviteMode === 'friend') {
      upsertFriend(senderUid, { name: inviterName, avatar: p._senderAvatar || p.avatar || '' });
    }
    state.inviteFrom = { uid: senderUid, name: inviterName, gameId: p.gameId, mode: inviteMode };
    state.inviteMode = inviteMode;
    state.publicWatch = inviteMode === 'public';
    state.phase = 'pending_accept';
    openPanel();
    renderInfo();
    toast(`${inviterName} 邀请你下五子棋`);
  }

  function onAccept(p, senderUid) {
    if (senderUid === state.myUid) return;
    if (state.phase !== 'inviting') return;
    if (p.gameId !== state.gameId) return;
    // 我是邀请方（执黑），对方接受 → 私发 start 并开局
    const accepterName = displayName(senderUid, p._senderName || p.fromName || p.acceptName);
    const inviteMode = state.inviteMode === 'friend' ? 'friend' : 'public';
    state.whiteUid = senderUid;
    state.blackUid = state.myUid;
    state.myColor = 'black';
    state.publicWatch = inviteMode === 'public';
    state.watchCode = state.publicWatch ? watchCodeFromGameId(state.gameId) : '';
    state.watchers = Object.create(null);
    if (inviteMode === 'friend') {
      upsertFriend(senderUid, { name: accepterName, avatar: p._senderAvatar || p.avatar || '' });
    }
    startGame();
    sendGame(
      'start',
      {
        gameId: state.gameId,
        watchCode: state.watchCode,
        inviteMode,
        publicWatch: state.publicWatch,
        blackUid: state.blackUid,
        whiteUid: state.whiteUid,
        blackName: displayName(state.blackUid, state.myName),
        whiteName: displayName(state.whiteUid, accepterName),
        boardSize: BOARD,
        next: 'black',
      },
      state.whiteUid
    );
    if (inviteMode === 'public') sendRoomNotice(buildStartNotice());
    toast(`${accepterName} 已接受，开始对局，你执黑`);
  }

  function onReject(p, senderUid) {
    if (senderUid === state.myUid) return;
    if (state.phase !== 'inviting' || p.gameId !== state.gameId) return;
    state.phase = 'idle';
    renderInfo();
    toast(`${displayName(senderUid, p._senderName || p.fromName)} 拒绝了邀请`);
  }

  function onStart(p, senderUid) {
    if (senderUid === state.myUid) return;
    // 我是被邀请方，收到开局确认
    if (p.gameId !== state.gameId && !(state.inviteFrom && state.inviteFrom.gameId === p.gameId)) return;
    state.gameId = p.gameId;
    state.inviteMode = p.inviteMode === 'friend' ? 'friend' : 'public';
    state.publicWatch = p.publicWatch !== false && state.inviteMode === 'public';
    state.watchCode = state.publicWatch ? (p.watchCode || watchCodeFromGameId(p.gameId)) : '';
    state.blackUid = p.blackUid;
    state.whiteUid = p.whiteUid;
    rememberName(state.blackUid, p.blackName);
    rememberName(state.whiteUid, p.whiteName);
    if (state.inviteMode === 'friend') {
      upsertFriend(senderUid, { name: p.blackName || p._senderName || p.fromName, avatar: p._senderAvatar || p.avatar || '' });
    }
    state.myColor = state.myUid === p.blackUid ? 'black' : 'white';
    startGame();
    toast('对局开始，你执' + (state.myColor === 'black' ? '黑' : '白'));
  }

  function onMove(p, senderUid) {
    if (p.gameId !== state.gameId) return;
    // 幂等：只接受「正好下一手」且颜色/发送者匹配的落子
    const expectSeq = state.moves.length + 1;
    if (p.seq < expectSeq) return; // 回显/重复，忽略
    if (p.seq > expectSeq) {
      // 出现缺口，私发请求对方重发完整局面
      log('seq 缺口，请求同步', p.seq, expectSeq);
      sendGame('sync_req', { gameId: state.gameId }, opponentUid());
      return;
    }
    const expectColor = colorForSeq(expectSeq);
    if (p.color !== expectColor) return;
    // 校验发送者就是该走的玩家
    const mover = expectColor === 'black' ? state.blackUid : state.whiteUid;
    if (senderUid && mover && senderUid !== mover && senderUid !== state.myUid) return;
    if (state.board[p.y] && state.board[p.y][p.x]) return; // 该点已有子
    applyMove(p.x, p.y, p.color);
    announceEndIfOwner();
    notifyWatchers();
  }

  function onResign(p, senderUid) {
    if (p.gameId !== state.gameId) return;
    if (senderUid === state.myUid) return;
    if (state.phase !== 'playing') return;
    state.winner = senderUid === state.blackUid ? 'white' : 'black';
    state.phase = 'finished';
    renderInfo();
    announceEndIfOwner();
    notifyWatchers();
    toast(`${displayName(senderUid, p._senderName || p.fromName)} 认输，你赢了`);
  }

  function onSyncReq(p, senderUid) {
    if (p.gameId !== state.gameId) return;
    if (senderUid === state.myUid) return;
    if (state.phase !== 'playing' && state.phase !== 'finished') return;
    // 私发回给请求者
    sendGame(
      'sync_state',
      {
        gameId: state.gameId,
        blackUid: state.blackUid,
        whiteUid: state.whiteUid,
        blackName: displayName(state.blackUid, state.blackUid === state.myUid ? state.myName : ''),
        whiteName: displayName(state.whiteUid, state.whiteUid === state.myUid ? state.myName : ''),
        inviteMode: state.inviteMode,
        publicWatch: state.publicWatch,
        boardSize: BOARD,
        moves: state.moves,
        status: state.phase,
        winner: state.winner,
      },
      senderUid
    );
  }

  function onSyncState(p, senderUid) {
    if (p.gameId !== state.gameId) return;
    if (senderUid === state.myUid) return;
    if (!Array.isArray(p.moves)) return;
    // 只在对方棋谱更长（更新）时采用
    if (p.moves.length <= state.moves.length) return;
    log('采用同步局面，手数', p.moves.length);
    state.blackUid = p.blackUid;
    state.whiteUid = p.whiteUid;
    rememberName(state.blackUid, p.blackName);
    rememberName(state.whiteUid, p.whiteName);
    state.myColor = state.myUid === p.blackUid ? 'black' : 'white';
    state.board = newBoard();
    state.moves = [];
    state.winner = null;
    state.phase = 'playing';
    for (const mv of p.moves) {
      if (mv && Number.isInteger(mv.x) && Number.isInteger(mv.y)) {
        applyMove(mv.x, mv.y, mv.color);
      }
    }
    if (p.status === 'finished') {
      state.winner = p.winner;
      state.phase = 'finished';
    }
    renderBoard();
    renderInfo();
  }

  function onWatchReq(p, senderUid) {
    if (senderUid === state.myUid) return;
    if (!state.publicWatch) return;
    if (state.blackUid !== state.myUid) return;
    if (state.phase !== 'playing' && state.phase !== 'finished') return;
    const code = cleanName(p.watchCode).toLowerCase();
    if (!code || code !== state.watchCode) return;
    const watcherName = displayName(senderUid, p._senderName || p.fromName);
    const isNewWatcher = !state.watchers[senderUid];
    state.watchers[senderUid] = {
      name: watcherName,
      ts: Date.now(),
    };
    sendWatchState(senderUid);
    if (isNewWatcher) toast(`${watcherName} 加入观战`);
  }

  function onWatchState(p, senderUid) {
    if (!p.gameId || !Array.isArray(p.moves)) return;
    if (state.ignoredWatchGames[p.gameId]) return;
    const firstEnterWatch = !(isWatcher() && state.gameId === p.gameId);
    if (!firstEnterWatch && p.moves.length < state.moves.length) return;
    rememberName(p.blackUid, p.blackName);
    rememberName(p.whiteUid, p.whiteName);
    state.gameId = p.gameId;
    state.inviteMode = 'public';
    state.publicWatch = true;
    state.watchCode = p.watchCode || watchCodeFromGameId(p.gameId);
    state.blackUid = p.blackUid;
    state.whiteUid = p.whiteUid;
    state.myColor = 'watcher';
    state.inviteFrom = null;
    state.board = newBoard();
    state.moves = [];
    state.winner = null;
    state.phase = p.status === 'finished' ? 'finished' : 'playing';
    for (const mv of p.moves) {
      if (mv && Number.isInteger(mv.x) && Number.isInteger(mv.y)) {
        applyMove(mv.x, mv.y, mv.color);
      }
    }
    if (p.status === 'finished') {
      state.winner = p.winner || state.winner;
      state.phase = 'finished';
    }
    openPanel();
    renderBoard();
    renderInfo();
    if (firstEnterWatch) toast('已进入观战');
  }

  function onWatchLeave(p, senderUid) {
    if (!senderUid || senderUid === state.myUid) return;
    if (p.gameId !== state.gameId) return;
    if (!state.watchers[senderUid]) return;
    delete state.watchers[senderUid];
    log('观战者退出', senderUid);
  }

  function onRemoteClose(p, senderUid) {
    if (p.gameId !== state.gameId) return;
    if (senderUid === state.myUid) return;
    if (state.phase === 'playing') {
      toast(`${displayName(senderUid, p._senderName || p.fromName)} 关闭了对局`);
    }
  }

  // ===================================================================
  // 对局控制
  // ===================================================================
  function startGame() {
    state.board = newBoard();
    state.moves = [];
    state.winner = null;
    state.phase = 'playing';
    state.endNoticeSent = false;
    state.inviteFrom = null;
    openPanel();
    renderBoard();
    renderInfo();
  }

  function doInvite() {
    if (state.phase === 'playing') {
      toast('正在对局中');
      return;
    }
    state.gameId = genGameId();
    state.watchCode = watchCodeFromGameId(state.gameId);
    state.inviteMode = 'public';
    state.publicWatch = true;
    state.phase = 'inviting';
    state.myColor = 'black';
    state.blackUid = state.myUid;
    state.whiteUid = null;
    state.board = newBoard();
    state.moves = [];
    state.winner = null;
    state.endNoticeSent = false;
    state.watchers = Object.create(null);
    // invite 必须公屏广播（让房间里的人能发现），不传 toUid
    sendGame('invite', {
      gameId: state.gameId,
      inviteMode: 'public',
      publicWatch: true,
      boardSize: BOARD,
      rule: 'free',
      colorMode: 'inviter_black',
    });
    renderInfo();
    toast('已发出邀请，等待对方接受…');
  }

  function doAccept() {
    if (state.phase !== 'pending_accept' || !state.inviteFrom) return;
    state.gameId = state.inviteFrom.gameId;
    state.inviteMode = state.inviteFrom.mode === 'friend' ? 'friend' : 'public';
    state.publicWatch = state.inviteMode === 'public';
    rememberName(state.myUid, getSelfName(state.win));
    // 私发给邀请方
    sendGame(
      'accept',
      {
        gameId: state.gameId,
        inviteMode: state.inviteMode,
        publicWatch: state.publicWatch,
        acceptUid: state.myUid,
        acceptName: state.myName,
      },
      state.inviteFrom.uid
    );
    toast('已接受，等待开始…');
  }

  function doAddFriend() {
    const input = window.prompt ? window.prompt('输入蔷薇 id，例如 [@686e2846380dc@]', '') : '';
    const uid = extractRoseUid(input);
    if (!uid) {
      toast('没有识别到有效 id');
      return;
    }
    if (uid === state.myUid) {
      toast('不能添加自己');
      return;
    }
    if (isFriend(uid)) {
      toast('已经是好友');
      return;
    }
    sendSocial('friend_req', { note: 'gomoku_friend_request', avatar: '' }, uid);
    toast('已发送好友申请');
  }

  function doToggleFriends() {
    state.showFriends = !state.showFriends;
    renderFriends();
  }

  function doInviteFriend(uid) {
    uid = cleanUid(uid);
    const friend = state.friends[uid];
    if (!friend) return;
    if (state.phase === 'playing') {
      toast('正在对局中');
      return;
    }
    state.gameId = genGameId();
    state.watchCode = '';
    state.inviteMode = 'friend';
    state.publicWatch = false;
    state.phase = 'inviting';
    state.myColor = 'black';
    state.blackUid = state.myUid;
    state.whiteUid = uid;
    state.board = newBoard();
    state.moves = [];
    state.winner = null;
    state.endNoticeSent = false;
    state.watchers = Object.create(null);
    sendGame('invite', {
      gameId: state.gameId,
      inviteMode: 'friend',
      publicWatch: false,
      toUid: uid,
      boardSize: BOARD,
      rule: 'free',
      colorMode: 'inviter_black',
    }, uid);
    renderInfo();
    toast(`已邀请 ${friend.name || uid}`);
  }

  function doReject() {
    if (state.phase !== 'pending_accept' || !state.inviteFrom) return;
    sendGame('reject', { gameId: state.inviteFrom.gameId }, state.inviteFrom.uid);
    state.phase = 'idle';
    state.inviteFrom = null;
    renderInfo();
  }

  function doResign() {
    if (state.phase !== 'playing' || !isPlayer()) return;
    sendGame('resign', { gameId: state.gameId }, opponentUid());
    state.winner = state.myColor === 'black' ? 'white' : 'black';
    state.phase = 'finished';
    renderInfo();
    announceEndIfOwner();
    notifyWatchers();
    toast('你认输了');
  }

  function doSyncReq() {
    if (state.phase !== 'playing') return;
    if (isWatcher()) {
      sendGame('watch_req', { watchCode: state.watchCode }, null);
      toast('已请求刷新观战局面');
      return;
    }
    sendGame('sync_req', { gameId: state.gameId }, opponentUid());
    toast('已请求同步局面');
  }

  function doWatch() {
    if (state.phase === 'playing' && isPlayer()) {
      toast('正在对局中');
      return;
    }
    const fallback = state.watchCode || latestKnownWatchCode();
    const text = window.prompt ? window.prompt('输入五子棋观战码', fallback) : fallback;
    const watchCode = cleanName(text).toLowerCase();
    if (!watchCode) return;
    unignoreWatchCode(watchCode);
    state.watchCode = watchCode;
    sendGame('watch_req', { watchCode }, null);
    toast('已发送观战请求');
  }

  function doReset() {
    if (state.phase === 'playing' && isPlayer()) {
      sendGame('close', { gameId: state.gameId }, opponentUid());
    }
    if (isWatcher() && state.gameId) {
      state.ignoredWatchGames[state.gameId] = Date.now();
      if (state.blackUid) {
        sendGame('watch_leave', { gameId: state.gameId }, state.blackUid);
      }
    }
    state.phase = 'idle';
    state.gameId = null;
    state.watchCode = '';
    state.moves = [];
    state.board = newBoard();
    state.winner = null;
    state.endNoticeSent = false;
    state.inviteFrom = null;
    state.myColor = null;
    state.watchers = Object.create(null);
    state.inviteMode = 'public';
    state.publicWatch = false;
    renderBoard();
    renderInfo();
  }

  // ===================================================================
  // UI
  // ===================================================================
  let dom = {};

  const POS_KEY = 'iiroseGomokuPanelPosition';
  const SIDEBAR_BTN_ID = 'iirose-gomoku-sidebar-btn';

  function injectStyle() {
    if (document.getElementById('iirose-gomoku-style')) return;
    const css = `
    #iirose-gomoku-launch{position:fixed;right:14px;bottom:120px;z-index:2147483646;
      background:#7b5cff;color:#fff;border:none;border-radius:20px;padding:8px 14px;
      font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);}
    #iirose-gomoku-panel{position:fixed;z-index:2147483647;width:min(92vw,420px);
      background:#f7f4ec;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);
      font-family:-apple-system,Segoe UI,Roboto,sans-serif;user-select:none;display:none;overflow:hidden;}
    #iirose-gomoku-panel .gmk-head{display:flex;align-items:center;gap:8px;padding:10px 12px;
      background:#7b5cff;color:#fff;cursor:move;font-size:14px;}
    #iirose-gomoku-panel .gmk-head .gmk-title{flex:1;font-weight:600;}
    #iirose-gomoku-panel .gmk-head .gmk-x{display:inline-flex;align-items:center;justify-content:center;
      width:28px;height:28px;margin:-4px -6px -4px 0;cursor:pointer;font-size:18px;line-height:1;
      touch-action:manipulation;user-select:none;}
    #iirose-gomoku-panel .gmk-body{padding:10px 12px 12px;}
    #iirose-gomoku-panel .gmk-info{font-size:13px;color:#444;margin-bottom:8px;min-height:18px;}
    #iirose-gomoku-panel canvas{display:block;background:#e7c27d;border-radius:6px;
      width:100%;touch-action:none;}
    #iirose-gomoku-panel .gmk-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
    #iirose-gomoku-panel .gmk-actions button{flex:1 0 auto;min-width:64px;padding:7px 10px;
      border:none;border-radius:8px;background:#efe7d6;color:#333;font-size:13px;cursor:pointer;}
    #iirose-gomoku-panel .gmk-actions button.primary{background:#7b5cff;color:#fff;}
    #iirose-gomoku-panel .gmk-friends{display:none;margin-top:10px;border-top:1px solid rgba(0,0,0,.12);padding-top:8px;
      max-height:min(38vh,260px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
    #iirose-gomoku-panel .gmk-friend-empty{font-size:12px;color:#777;padding:4px 0;}
    #iirose-gomoku-panel .gmk-friend-row{display:flex;align-items:center;gap:8px;padding:6px 0;
      border-bottom:1px solid rgba(0,0,0,.08);}
    #iirose-gomoku-panel .gmk-avatar{width:28px;height:28px;border-radius:50%;background:#ddd;object-fit:cover;flex:0 0 auto;}
    #iirose-gomoku-panel .gmk-friend-main{min-width:0;flex:1;}
    #iirose-gomoku-panel .gmk-friend-name{font-size:13px;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #iirose-gomoku-panel .gmk-friend-uid{font-size:11px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #iirose-gomoku-panel .gmk-friend-row button{border:none;border-radius:7px;background:#efe7d6;color:#333;
      font-size:12px;padding:5px 8px;cursor:pointer;flex:0 0 auto;}
    #iirose-gomoku-toast{position:fixed;left:50%;top:18%;transform:translateX(-50%);
      background:rgba(0,0,0,.82);color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;
      z-index:2147483647;opacity:0;transition:opacity .25s;pointer-events:none;max-width:80vw;text-align:center;}
    `;
    const st = document.createElement('style');
    st.id = 'iirose-gomoku-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildUI() {
    injectStyle();

    const launch = document.createElement('button');
    launch.id = 'iirose-gomoku-launch';
    launch.textContent = '五子棋';
    launch.onclick = openPanel;
    document.body.appendChild(launch);
    dom.launch = launch;

    const panel = document.createElement('div');
    panel.id = 'iirose-gomoku-panel';
    panel.innerHTML = `
      <div class="gmk-head">
        <span class="gmk-title">五子棋</span>
        <span class="gmk-x">×</span>
      </div>
      <div class="gmk-body">
        <div class="gmk-info"></div>
        <canvas></canvas>
        <div class="gmk-actions"></div>
        <div class="gmk-friends"></div>
      </div>`;
    document.body.appendChild(panel);
    dom.panel = panel;
    dom.info = panel.querySelector('.gmk-info');
    dom.canvas = panel.querySelector('canvas');
    dom.actions = panel.querySelector('.gmk-actions');
    dom.friends = panel.querySelector('.gmk-friends');
    const closeBtn = panel.querySelector('.gmk-x');
    closeBtn.addEventListener('click', handleCloseTap);
    closeBtn.addEventListener('touchstart', stopCloseDrag, { passive: false });
    closeBtn.addEventListener('touchend', handleCloseTap, { passive: false });

    setupDrag(panel, panel.querySelector('.gmk-head'));
    setupCanvas();
    restorePos();
    renderInfo();
    installSidebarLaunch(0);
  }

  function getCandidateDocuments() {
    const docs = [];
    function addDoc(doc) {
      if (doc && docs.indexOf(doc) < 0) docs.push(doc);
    }
    addDoc(document);
    try {
      if (state.win && state.win.document) addDoc(state.win.document);
    } catch (e) {}
    try {
      const iframe = document.getElementById('mainFrame');
      if (iframe && iframe.contentDocument) addDoc(iframe.contentDocument);
    } catch (e) {}
    return docs;
  }

  function findToolsBoxInDocument(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    const groups = doc.querySelectorAll('.functionButton.functionButtonGroup');
    for (const group of groups) {
      const label = group.querySelector('.functionBtnFont');
      if (!label || cleanName(label.textContent) !== '工具') continue;
      const box = group.nextElementSibling;
      if (box && box.classList && box.classList.contains('functionItemBox')) {
        return { doc, box };
      }
    }
    return null;
  }

  function findToolsBox() {
    for (const doc of getCandidateDocuments()) {
      const found = findToolsBoxInDocument(doc);
      if (found) return found;
    }
    return null;
  }

  function installSidebarLaunch(attempt) {
    const found = findToolsBox();
    if (!found) {
      if (dom.launch) dom.launch.style.display = '';
      if (attempt < 60) setTimeout(() => installSidebarLaunch(attempt + 1), 500);
      return false;
    }
    const doc = found.doc;
    const box = found.box;
    let btn = doc.getElementById(SIDEBAR_BTN_ID);
    if (!btn) {
      btn = doc.createElement('div');
      btn.id = SIDEBAR_BTN_ID;
      btn.className = 'functionButton';
      btn.title = '五子棋';
      btn.innerHTML = '<span class="functionBtnIcon mdi-chess-pawn"></span><span class="functionBtnFont">五子棋</span>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanel();
      });
    }
    if (btn.parentElement !== box || box.firstElementChild !== btn) {
      box.insertBefore(btn, box.firstChild);
    }
    if (dom.launch) dom.launch.style.display = 'none';
    return true;
  }

  function openPanel() {
    if (!dom.panel) return;
    dom.panel.style.display = 'block';
    renderBoard();
    renderInfo();
    renderFriends();
  }
  function closePanel() {
    if (dom.panel) dom.panel.style.display = 'none';
  }

  function stopCloseDrag(e) {
    e.stopPropagation();
  }

  function handleCloseTap(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closePanel();
  }

  function setupDrag(panel, handle) {
    let sx, sy, ox, oy, dragging = false;
    function down(e) {
      if (e.target && e.target.closest && e.target.closest('.gmk-x')) return;
      dragging = true;
      const pt = e.touches ? e.touches[0] : e;
      sx = pt.clientX; sy = pt.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left; oy = r.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      let nx = ox + (pt.clientX - sx);
      let ny = oy + (pt.clientY - sy);
      nx = Math.max(0, Math.min(window.innerWidth - 60, nx));
      ny = Math.max(0, Math.min(window.innerHeight - 30, ny));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      savePos();
    }
    handle.addEventListener('mousedown', down);
    handle.addEventListener('touchstart', down, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
  }

  function savePos() {
    try {
      const r = dom.panel.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
    } catch (e) {}
  }
  function restorePos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        dom.panel.style.left = p.left + 'px';
        dom.panel.style.top = p.top + 'px';
        dom.panel.style.right = 'auto';
        dom.panel.style.bottom = 'auto';
        return;
      }
    } catch (e) {}
    dom.panel.style.right = '14px';
    dom.panel.style.top = '80px';
  }

  // ---- 棋盘绘制 ----
  let cellSize = 0, padding = 0;

  function setupCanvas() {
    const c = dom.canvas;
    function clickAt(e) {
      const rect = c.getBoundingClientRect();
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      const px = pt.clientX - rect.left;
      const py = pt.clientY - rect.top;
      // canvas 显示宽度可能被 CSS 缩放，换算回逻辑像素
      const scaleX = c.width / rect.width;
      const scaleY = c.height / rect.height;
      const lx = px * scaleX, ly = py * scaleY;
      const gx = Math.round((lx - padding) / cellSize);
      const gy = Math.round((ly - padding) / cellSize);
      if (gx < 0 || gy < 0 || gx >= BOARD || gy >= BOARD) return;
      tryLocalMove(gx, gy);
    }
    c.addEventListener('click', clickAt);
  }

  function renderBoard() {
    const c = dom.canvas;
    if (!c) return;
    // 逻辑像素：固定 size，CSS 负责自适应缩放
    const size = 420;
    c.width = size;
    c.height = size;
    padding = size / (BOARD + 1);
    cellSize = (size - padding * 2) / (BOARD - 1);

    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#e7c27d';
    ctx.fillRect(0, 0, size, size);

    // 网格线
    ctx.strokeStyle = '#7a5a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < BOARD; i++) {
      const p = padding + i * cellSize;
      ctx.moveTo(padding, p);
      ctx.lineTo(size - padding, p);
      ctx.moveTo(p, padding);
      ctx.lineTo(p, size - padding);
    }
    ctx.stroke();

    // 星位
    const stars = [3, 7, 11];
    ctx.fillStyle = '#5a3f1a';
    for (const sx of stars) {
      for (const sy of stars) {
        ctx.beginPath();
        ctx.arc(padding + sx * cellSize, padding + sy * cellSize, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 棋子
    if (state.board) {
      for (let y = 0; y < BOARD; y++) {
        for (let x = 0; x < BOARD; x++) {
          const col = state.board[y][x];
          if (!col) continue;
          drawStone(ctx, x, y, col);
        }
      }
      // 最后一手标记
      const last = state.moves[state.moves.length - 1];
      if (last) {
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(padding + last.x * cellSize, padding + last.y * cellSize, cellSize * 0.32, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawStone(ctx, x, y, color) {
    const cx = padding + x * cellSize;
    const cy = padding + y * cellSize;
    const r = cellSize * 0.42;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color === 'black' ? '#222' : '#fafafa';
    ctx.fill();
    ctx.strokeStyle = color === 'black' ? '#000' : '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function renderInfo() {
    if (!dom.info) return;
    let txt = '';
    switch (state.phase) {
      case 'idle':
        txt = '好友私聊邀请不刷屏；公开邀请仍支持观战';
        break;
      case 'inviting':
        txt = '已发出邀请，等待接受…';
        break;
      case 'pending_accept':
        txt = `收到 ${state.inviteFrom ? state.inviteFrom.name : '对方'} 的邀请`;
        break;
      case 'playing': {
        const blackName = displayName(state.blackUid, state.blackUid === state.myUid ? state.myName : '');
        const whiteName = displayName(state.whiteUid, state.whiteUid === state.myUid ? state.myName : '');
        if (isWatcher()) {
          const turnName = nextColor() === 'black' ? blackName : whiteName;
          txt = `观战中 · 黑 ${blackName} · 白 ${whiteName} · ${turnName} 行棋 · 第${state.moves.length}手`;
        } else {
          const me = state.myColor === 'black' ? '黑' : '白';
          const turn = nextColor() === state.myColor ? '轮到你' : '等待对方';
          txt = `黑 ${blackName} · 白 ${whiteName} · 你执${me} · ${turn} · 第${state.moves.length}手`;
        }
        break;
      }
      case 'finished':
        if (isWatcher()) txt = '观战对局已结束';
        else if (state.winner === 'draw') txt = '和棋';
        else if (state.winner === state.myColor) txt = '🎉 你赢了';
        else txt = '你输了';
        break;
    }
    dom.info.textContent = txt;
    renderActions();
  }

  function renderActions() {
    if (!dom.actions) return;
    const a = dom.actions;
    a.innerHTML = '';
    const mk = (label, fn, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = fn;
      a.appendChild(b);
    };
    switch (state.phase) {
      case 'idle':
      case 'finished':
        mk('好友', doToggleFriends, true);
        mk('加好友', doAddFriend);
        mk('公开邀请', doInvite);
        mk('观战', doWatch);
        if (state.phase === 'finished') mk('清空', doReset);
        break;
      case 'inviting':
        mk('取消', doReset);
        break;
      case 'pending_accept':
        mk('接受', doAccept, true);
        mk('拒绝', doReject);
        break;
      case 'playing':
        if (isWatcher()) {
          mk('同步', doSyncReq);
          mk('退出观战', doReset);
        } else {
          mk('认输', doResign);
          mk('同步', doSyncReq);
        }
        break;
    }
    renderFriends();
  }

  function renderFriends() {
    if (!dom.friends) return;
    dom.friends.style.display = state.showFriends ? 'block' : 'none';
    if (!state.showFriends) {
      dom.friends.innerHTML = '';
      return;
    }
    dom.friends.innerHTML = '';
    const list = friendList();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'gmk-friend-empty';
      empty.textContent = '暂无好友，点「加好友」输入蔷薇 id。';
      dom.friends.appendChild(empty);
      return;
    }
    for (const friend of list) {
      const row = document.createElement('div');
      row.className = 'gmk-friend-row';

      const avatar = document.createElement(friend.avatar ? 'img' : 'div');
      avatar.className = 'gmk-avatar';
      if (friend.avatar) {
        avatar.alt = '';
        avatar.src = friend.avatar;
      }

      const main = document.createElement('div');
      main.className = 'gmk-friend-main';
      const name = document.createElement('div');
      name.className = 'gmk-friend-name';
      name.textContent = friend.name || friend.uid;
      const uid = document.createElement('div');
      uid.className = 'gmk-friend-uid';
      uid.textContent = friend.uid;
      main.appendChild(name);
      main.appendChild(uid);

      const invite = document.createElement('button');
      invite.textContent = '邀请';
      invite.onclick = () => doInviteFriend(friend.uid);

      const remove = document.createElement('button');
      remove.textContent = '删除';
      remove.onclick = () => {
        if (!window.confirm || window.confirm(`删除好友 ${friend.name || friend.uid}？`)) {
          removeFriend(friend.uid);
        }
      };

      row.appendChild(avatar);
      row.appendChild(main);
      row.appendChild(invite);
      row.appendChild(remove);
      dom.friends.appendChild(row);
    }
  }

  // ---- toast ----
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('iirose-gomoku-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'iirose-gomoku-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.opacity = '0'), 2200);
  }

  // ===================================================================
  // 启动
  // ===================================================================
  function boot(attempt) {
    const win = getIIROSEWindow();
    if (!win) {
      if (attempt < 40) return setTimeout(() => boot(attempt + 1), 500);
      log('未找到 iirose socket，放弃接入（UI 仍可单机查看）');
      loadFriends();
      buildUI();
      return;
    }
    state.win = win;
    state.myUid = getSelfUid(win);
    state.myName = getSelfName(win);
    rememberName(state.myUid, state.myName);
    loadFriends();
    installInterceptor(win);
    buildUI();
    log('已接入 iirose，self uid =', state.myUid, 'name =', state.myName);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(0));
  } else {
    boot(0);
  }
})();
