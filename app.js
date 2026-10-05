const STORAGE_KEY = "beartoys-prize-manager-v1";
const CLOUD_CONFIG_KEY = "beartoys-prize-manager-cloud-config-v1";
const DEFAULT_CLOUD_SETTINGS = {
  url: "https://qvfifwhgfkfjojaycnkx.supabase.co",
  anonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2Zmlmd2hnZmtmam9qYXljbmt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExNTQxMjAsImV4cCI6MjEwNjczMDEyMH0._RyEowyrslZpxkPMPc_vGPr94xes8PS8HZfyWUJF-tU"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const toInt = (value) => Math.max(0, Number.parseInt(value, 10) || 0);
const signedInt = (value) => Number.parseInt(value, 10) || 0;
const moneyless = (value) => Number(value || 0).toLocaleString("zh-Hant-TW");
const authRedirectUrl = () => window.location.href.split("#")[0];

let cloudClient = null;
let cloudSaveTimer = null;
let cloudSettings = loadCloudSettings();
let cloudUser = null;
let cloudAuthSubscription = null;
let state = loadState();
let pendingActivityDeleteCode = "";

function seedState() {
  const activityA = uid();
  const activityB = uid();
  const itemA = uid();
  const itemB = uid();
  const itemC = uid();
  const orderA = uid();
  const orderB = uid();
  const orderC = uid();
  const sourceLine = uid();
  const sourcePlatformA = uid();
  const sourcePlatformB = uid();

  return {
    sources: [
      { id: sourceLine, name: "LINE 群組", note: "手動群組訂單", createdAt: now(), updatedAt: now() },
      { id: sourcePlatformA, name: "線上平台 A", note: "", createdAt: now(), updatedAt: now() },
      { id: sourcePlatformB, name: "線上平台 B", note: "", createdAt: now(), updatedAt: now() }
    ],
    activities: [
      { id: activityA, name: "十月一番賞", note: "展示範例", createdAt: now(), updatedAt: now() },
      { id: activityB, name: "週年抽賞池", note: "", createdAt: now(), updatedAt: now() }
    ],
    items: [
      {
        id: itemA,
        activityId: activityA,
        name: "A賞 毛絨玩偶",
        initialStock: 20,
        incomingPending: 30,
        stockAdjustment: 0,
        note: "",
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: itemB,
        activityId: activityA,
        name: "B賞 壓克力立牌",
        initialStock: 5,
        incomingPending: 0,
        stockAdjustment: 0,
        note: "",
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: itemC,
        activityId: activityB,
        name: "A賞 毛絨玩偶",
        initialStock: 8,
        incomingPending: 12,
        stockAdjustment: 0,
        note: "同名品項但不同活動",
        createdAt: now(),
        updatedAt: now()
      }
    ],
    orders: [
      {
        id: orderA,
        customerName: "王小美",
        memberCode: "BT001",
        sourceId: sourceLine,
        note: "",
        lines: [{ id: uid(), activityId: activityA, itemId: itemA, orderedQty: 100, cancelledQty: 10, shippedQty: 30 }],
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: orderB,
        customerName: "陳先生",
        memberCode: "BT002",
        sourceId: sourcePlatformA,
        note: "",
        lines: [{ id: uid(), activityId: activityA, itemId: itemB, orderedQty: 6, cancelledQty: 0, shippedQty: 2 }],
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: orderC,
        customerName: "王小美",
        memberCode: "BT999",
        sourceId: sourcePlatformB,
        note: "同名不同會員代號，用來展示姓名提示",
        lines: [{ id: uid(), activityId: activityB, itemId: itemC, orderedQty: 5, cancelledQty: 0, shippedQty: 0 }],
        createdAt: now(),
        updatedAt: now()
      }
    ],
    receipts: [],
    shipments: [{ id: uid(), orderId: orderA, itemId: itemA, shippedQty: 30, date: today(), note: "展示範例", createdAt: now() }],
    disputes: [
      {
        id: uid(),
        memberCode: "BT001",
        customerName: "王小美",
        reason: "取消數量確認中",
        relatedOrderId: orderA,
        status: "processing",
        isFlagged: true,
        date: today(),
        note: "新增訂單時應提醒",
        createdAt: now(),
        updatedAt: now()
      }
    ],
    history: [],
    version: 1
  };
}

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return seedState();
  try {
    return normalizeState({ ...seedState(), ...JSON.parse(stored) });
  } catch {
    return seedState();
  }
}

function normalizeState(nextState) {
  const base = seedState();
  const normalized = { ...base, ...nextState };
  if (!Array.isArray(normalized.sources) || normalized.sources.length === 0) normalized.sources = base.sources;
  return normalized;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueCloudSave();
}

function loadCloudSettings() {
  const stored = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (!stored) return { ...DEFAULT_CLOUD_SETTINGS };
  try {
    const parsed = JSON.parse(stored);
    return {
      url: parsed.url || DEFAULT_CLOUD_SETTINGS.url,
      anonKey: parsed.anonKey || DEFAULT_CLOUD_SETTINGS.anonKey
    };
  } catch {
    return { ...DEFAULT_CLOUD_SETTINGS };
  }
}

function saveCloudSettings(settings) {
  cloudSettings = settings;
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(settings));
}

function hasCloudSettings() {
  return Boolean(cloudSettings.url && cloudSettings.anonKey);
}

function createCloudClient() {
  if (!hasCloudSettings() || !window.supabase?.createClient) return null;
  return window.supabase.createClient(cloudSettings.url, cloudSettings.anonKey);
}

function setCloudResult(message, type = "neutral") {
  ["#cloud-result"].forEach((selector) => {
    const box = $(selector);
    if (!box) return;
    box.textContent = message;
    box.className = `result-box ${type}`;
  });
}

function setAuthStatus(message, type = "neutral") {
  ["#auth-status", "#gate-auth-status"].forEach((selector) => {
    const box = $(selector);
    if (!box) return;
    box.textContent = message;
    box.className = `result-box ${type}`;
  });
}

function formatAuthError(error) {
  const message = error?.message || "";
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "登入失敗：Email 或密碼不正確。";
  if (normalized.includes("email not confirmed")) return "登入失敗：請先到信箱完成 Email 驗證。";
  if (normalized.includes("signup")) return "帳號建立失敗：目前不允許公開註冊，請到 Supabase 建立使用者。";
  if (normalized.includes("rate limit")) return "登入太頻繁，請稍等一下再試。";
  return `登入失敗：${message || "請確認帳號密碼後再試。"}`;
}

function setLoginBusy(isBusy) {
  ["#auth-login", "#gate-auth-login"].forEach((selector) => {
    const button = $(selector);
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = isBusy ? "登入中..." : "登入";
  });
}

function setStorageNote(message) {
  const note = $("#storage-note");
  if (note) note.textContent = message;
}

function updateCloudUi({ authStatus = true } = {}) {
  ["#cloud-url"].forEach((selector) => {
    const input = $(selector);
    if (input) input.value = cloudSettings.url || "";
  });
  ["#cloud-key"].forEach((selector) => {
    const input = $(selector);
    if (input) input.value = cloudSettings.anonKey || "";
  });
  if (authStatus) {
    setAuthStatus(cloudUser ? `已登入：${cloudUser.email || cloudUser.id}` : "尚未登入。", cloudUser ? "ok" : "neutral");
  }
  setStorageNote(
    cloudClient && cloudUser
      ? "資料已啟用 Supabase 雲端同步，同時保留本機備份"
      : "展示版資料儲存在本機瀏覽器 localStorage"
  );
  updateAccessGate();
}

function updateAccessGate() {
  const unlocked = Boolean(cloudClient && cloudUser);
  $("#auth-gate")?.classList.toggle("hidden", unlocked);
  $("#app-shell")?.classList.toggle("hidden", !unlocked);
}

async function initCloudSync({ pullRemote = true } = {}) {
  if (!hasCloudSettings()) {
    cloudClient = null;
    updateCloudUi();
    return false;
  }

  cloudClient = createCloudClient();
  if (!cloudClient) {
    setCloudResult("找不到 Supabase SDK，請確認網路可載入 supabase-js。", "error");
    setAuthStatus("雲端連線載入失敗，請確認網路後重新整理。", "error");
    updateCloudUi({ authStatus: false });
    return false;
  }

  if (cloudAuthSubscription) {
    cloudAuthSubscription.unsubscribe();
    cloudAuthSubscription = null;
  }

  const sessionResult = await cloudClient.auth.getSession();
  if (sessionResult.error) {
    setCloudResult(`讀取登入狀態失敗：${sessionResult.error.message}`, "error");
    updateCloudUi();
    return false;
  }

  cloudUser = sessionResult.data.session?.user || null;
  const listener = cloudClient.auth.onAuthStateChange(async (_event, session) => {
    cloudUser = session?.user || null;
    updateCloudUi();
    if (cloudUser) {
      const pulled = await pullCloudState({ quietIfEmpty: true });
      if (!pulled) renderAll({ skipSave: true });
    }
  });
  cloudAuthSubscription = listener.data.subscription;

  if (!cloudUser) {
    setCloudResult("已儲存 Supabase 設定。請先登入，登入後才會同步資料。", "neutral");
    updateCloudUi();
    return true;
  }

  if (!pullRemote) {
    updateCloudUi();
    return true;
  }

  const pulled = await pullCloudState({ quietIfEmpty: true });
  if (!pulled) {
    await pushCloudState({ quiet: true });
    renderAll({ skipSave: true });
  }
  setCloudResult(pulled ? "已連線，並載入雲端資料。" : "已連線，並把目前本機資料建立到雲端。", "ok");
  updateCloudUi();
  return true;
}

async function pullCloudState({ quietIfEmpty = false } = {}) {
  if (!cloudClient) cloudClient = createCloudClient();
  if (!cloudClient || !cloudUser) {
    setCloudResult("尚未連線或尚未登入。", "error");
    return false;
  }

  const { data, error } = await cloudClient
    .from("app_state")
    .select("data, updated_at")
    .eq("user_id", cloudUser.id)
    .maybeSingle();

  if (error) {
    setCloudResult(`下載失敗：${error.message}`, "error");
    return false;
  }

  if (!data?.data) {
    if (!quietIfEmpty) setCloudResult("雲端目前沒有資料，可以先按「上傳本機資料」。", "neutral");
    return false;
  }

  state = normalizeState({ ...seedState(), ...data.data });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll({ skipSave: true });
  setCloudResult(`已從雲端下載資料。最後更新：${data.updated_at || "未知"}`, "ok");
  return true;
}

async function pushCloudState({ quiet = false } = {}) {
  if (!cloudClient) cloudClient = createCloudClient();
  if (!cloudClient || !cloudUser) {
    if (!quiet) setCloudResult("尚未連線或尚未登入。", "error");
    return false;
  }

  const { error } = await cloudClient.from("app_state").upsert({
    user_id: cloudUser.id,
    data: state,
    updated_at: now()
  });

  if (error) {
    if (!quiet) setCloudResult(`上傳失敗：${error.message}`, "error");
    return false;
  }

  if (!quiet) setCloudResult("已上傳本機資料到 Supabase。", "ok");
  return true;
}

function queueCloudSave() {
  if (!cloudClient || !cloudUser) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    pushCloudState({ quiet: true }).catch((error) => {
      setCloudResult(`自動同步失敗：${error.message}`, "error");
    });
  }, 500);
}

async function signInWithEmail(email, password) {
  if (!email || !password) {
    setAuthStatus("請輸入 Email 和密碼。", "error");
    return;
  }
  setLoginBusy(true);
  try {
    if (!cloudClient) await initCloudSync({ pullRemote: false });
    if (!cloudClient) {
      setAuthStatus("雲端連線尚未完成，請重新整理後再試。", "error");
      return;
    }
    setAuthStatus("正在登入，請稍候...", "neutral");
    const { data, error } = await cloudClient.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthStatus(formatAuthError(error), "error");
      return;
    }
    cloudUser = data.user;
    setAuthStatus(`已登入：${cloudUser.email}`, "ok");
    const pulled = await pullCloudState({ quietIfEmpty: true });
    if (!pulled) await pushCloudState({ quiet: true });
    if (!pulled) renderAll({ skipSave: true });
    updateCloudUi();
  } catch (error) {
    setAuthStatus(`登入時發生錯誤：${error.message || "請稍後再試。"}`, "error");
  } finally {
    setLoginBusy(false);
  }
}

async function signUpWithEmail(email, password) {
  if (!cloudClient) await initCloudSync({ pullRemote: false });
  if (!cloudClient) return;
  const { data, error } = await cloudClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: authRedirectUrl()
    }
  });
  if (error) {
    setAuthStatus(`建立帳號失敗：${error.message}`, "error");
    return;
  }
  cloudUser = data.session?.user || null;
  setAuthStatus(data.session ? `已建立並登入：${email}` : "帳號已建立，請到信箱確認後再登入。", data.session ? "ok" : "neutral");
  if (data.session) {
    await pushCloudState({ quiet: true });
    renderAll({ skipSave: true });
  }
  updateCloudUi();
}

async function signOut() {
  if (!cloudClient) return;
  await cloudClient.auth.signOut();
  cloudUser = null;
  setAuthStatus("已登出。", "neutral");
  updateCloudUi();
}

function activityName(id) {
  return state.activities.find((activity) => activity.id === id)?.name || "未設定活動";
}

function sourceName(id) {
  return state.sources?.find((source) => source.id === id)?.name || "未分類";
}

function sourceOptions() {
  return (state.sources || []).map((source) => ({ value: source.id, label: source.name }));
}

function itemName(id) {
  return state.items.find((item) => item.id === id)?.name || "未設定品項";
}

function itemById(id) {
  return state.items.find((item) => item.id === id);
}

function allLines() {
  return state.orders.flatMap((order) =>
    order.lines.map((line) => ({
      ...line,
      orderId: order.id,
      customerName: order.customerName,
      memberCode: order.memberCode,
      sourceId: order.sourceId || ""
    }))
  );
}

function inventoryForItem(item) {
  const lines = allLines().filter((line) => line.itemId === item.id);
  const orderedQty = lines.reduce((sum, line) => sum + line.orderedQty, 0);
  const cancelledQty = lines.reduce((sum, line) => sum + line.cancelledQty, 0);
  const shippedQty = lines.reduce((sum, line) => sum + line.shippedQty, 0);
  const receivedQty = state.receipts
    .filter((receipt) => receipt.itemId === item.id)
    .reduce((sum, receipt) => sum + receipt.receivedQty, 0);
  const effectiveDemand = Math.max(orderedQty - cancelledQty, 0);
  const unshippedQty = Math.max(effectiveDemand - shippedQty, 0);
  const availableStock = item.initialStock + receivedQty + item.stockAdjustment - shippedQty;
  const needQty = Math.max(unshippedQty - availableStock, 0);

  return {
    item,
    activityName: activityName(item.activityId),
    orderedQty,
    cancelledQty,
    effectiveDemand,
    shippedQty,
    unshippedQty,
    availableStock,
    incomingPending: item.incomingPending,
    needQty
  };
}

function lineStatus(line) {
  const effective = Math.max(line.orderedQty - line.cancelledQty, 0);
  const unshipped = Math.max(effective - line.shippedQty, 0);
  if (effective === 0) return { key: "cancelled", text: "已取消", className: "neutral" };
  if (unshipped === 0) return { key: "shipped", text: "已出貨", className: "ok" };
  if (line.shippedQty > 0 || line.cancelledQty > 0) return { key: "partial", text: "部分處理", className: "incoming" };
  return { key: "open", text: "未完成", className: "shortage" };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setOptions(select, options, placeholder = "請選擇") {
  select.innerHTML = `<option value="">${placeholder}</option>${options
    .map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`)
    .join("")}`;
}

function activityOptions() {
  return state.activities.map((activity) => ({ value: activity.id, label: activity.name }));
}

function itemOptions(activityId = "") {
  return state.items
    .filter((item) => !activityId || item.activityId === activityId)
    .map((item) => ({ value: item.id, label: `${item.name}｜${activityName(item.activityId)}` }));
}

function activityUsage(activityId) {
  const itemIds = state.items.filter((item) => item.activityId === activityId).map((item) => item.id);
  const lines = allLines().filter((line) => line.activityId === activityId || itemIds.includes(line.itemId));
  const receipts = state.receipts.filter((receipt) => receipt.activityId === activityId || itemIds.includes(receipt.itemId));
  const shipments = state.shipments.filter((shipment) => itemIds.includes(shipment.itemId));
  return { itemIds, lines, receipts, shipments };
}

function renderSelects() {
  const activitySelects = [
    "#order-activity",
    "#receipt-activity",
    "#item-activity",
    "#dashboard-activity-filter"
  ];
  activitySelects.forEach((selector) => {
    const selected = $(selector)?.value || "";
    setOptions($(selector), activityOptions(), selector.includes("filter") ? "全部活動" : "請選擇活動");
    $(selector).value = selected;
  });

  setOptions($("#order-item"), itemOptions($("#order-activity").value), "請選擇品項");
  setOptions($("#receipt-item"), itemOptions($("#receipt-activity").value), "請選擇品項");

  ["#order-source", "#import-source"].forEach((selector) => {
    const selected = $(selector)?.value || "";
    setOptions($(selector), sourceOptions(), "未分類");
    $(selector).value = selected;
  });

  const sourceFilter = $("#order-source-filter");
  const sourceFilterSelected = sourceFilter?.value || "";
  setOptions(sourceFilter, sourceOptions(), "全部來源");
  sourceFilter.value = sourceFilterSelected;

  const shippable = allLines()
    .filter((line) => Math.max(line.orderedQty - line.cancelledQty - line.shippedQty, 0) > 0)
    .map((line) => ({
      value: line.orderId,
      label: `${line.customerName} ${line.memberCode}｜${activityName(line.activityId)}｜${itemName(line.itemId)}｜未出貨 ${line.orderedQty - line.cancelledQty - line.shippedQty}`
    }));
  setOptions($("#shipment-order"), shippable, "請選擇訂單");

  const orderOptions = state.orders.map((order) => ({
    value: order.id,
    label: `${order.customerName} ${order.memberCode}`
  }));
  setOptions($("#dispute-order"), orderOptions, "無相關訂單");
}

function renderDashboard() {
  const rows = state.items.map(inventoryForItem);
  const shortageRows = rows.filter((row) => row.needQty > 0);
  const pendingRows = rows.filter((row) => row.incomingPending > 0);
  const totalNeed = rows.reduce((sum, row) => sum + row.needQty, 0);
  const unshipped = rows.reduce((sum, row) => sum + row.unshippedQty, 0);

  $("#stats-grid").innerHTML = [
    ["缺貨品項", shortageRows.length],
    ["總還需收貨", totalNeed],
    ["尚未出貨", unshipped],
    ["待到貨品項", pendingRows.length]
  ]
    .map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${moneyless(value)}</strong></article>`)
    .join("");

  const activityFilter = $("#dashboard-activity-filter").value;
  const statusFilter = $("#dashboard-status-filter").value;
  const search = $("#dashboard-search").value.trim().toLowerCase();

  const filtered = rows
    .filter((row) => !activityFilter || row.item.activityId === activityFilter)
    .filter((row) => {
      if (statusFilter === "shortage") return row.needQty > 0;
      if (statusFilter === "enough") return row.needQty === 0;
      if (statusFilter === "incoming") return row.incomingPending > 0;
      return true;
    })
    .filter((row) => !search || `${row.activityName} ${row.item.name}`.toLowerCase().includes(search))
    .sort((a, b) => b.needQty - a.needQty || b.unshippedQty - a.unshippedQty);

  $("#dashboard-table").innerHTML =
    filtered
      .map((row) => {
        const badge =
          row.needQty > 0
            ? `<span class="badge shortage">缺貨</span>`
            : row.incomingPending > 0
              ? `<span class="badge incoming">待到貨</span>`
              : `<span class="badge ok">足夠</span>`;
        return `<tr>
          <td>${badge}</td>
          <td>${escapeHtml(row.activityName)}</td>
          <td>${escapeHtml(row.item.name)}</td>
          <td>${moneyless(row.effectiveDemand)}</td>
          <td>${moneyless(row.shippedQty)}</td>
          <td>${moneyless(row.unshippedQty)}</td>
          <td>${moneyless(row.availableStock)}</td>
          <td>${moneyless(row.incomingPending)}</td>
          <td class="${row.needQty > 0 ? "number-strong" : ""}">${moneyless(row.needQty)}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="9">目前沒有符合條件的品項。</td></tr>`;
}

function renderOrders() {
  const search = $("#order-search").value.trim().toLowerCase();
  const statusFilter = $("#order-status-filter").value;
  const sourceFilter = $("#order-source-filter").value;
  const rows = allLines()
    .map((line) => ({ ...line, status: lineStatus(line) }))
    .filter((line) => statusFilter === "all" || line.status.key === statusFilter)
    .filter((line) => !sourceFilter || line.sourceId === sourceFilter)
    .filter((line) => {
      const text = `${line.customerName} ${line.memberCode} ${sourceName(line.sourceId)} ${activityName(line.activityId)} ${itemName(line.itemId)}`.toLowerCase();
      return !search || text.includes(search);
    })
    .sort((a, b) => b.orderId.localeCompare(a.orderId));

  $("#orders-table").innerHTML =
    rows
      .map((line) => {
        const effective = Math.max(line.orderedQty - line.cancelledQty, 0);
        const unshipped = Math.max(effective - line.shippedQty, 0);
        return `<tr>
          <td><span class="badge ${line.status.className}">${line.status.text}</span></td>
          <td>${escapeHtml(line.customerName)}</td>
          <td>${escapeHtml(line.memberCode)}</td>
          <td>${escapeHtml(sourceName(line.sourceId))}</td>
          <td>${escapeHtml(activityName(line.activityId))}</td>
          <td>${escapeHtml(itemName(line.itemId))}</td>
          <td>${moneyless(line.orderedQty)}</td>
          <td>${moneyless(line.cancelledQty)}</td>
          <td>${moneyless(line.shippedQty)}</td>
          <td>${moneyless(unshipped)}</td>
          <td>
            <div class="row-actions">
              <button data-edit-order="${line.orderId}">修改</button>
              <button data-action-line="cancel" data-order-id="${line.orderId}">取消</button>
              <button data-action-line="ship" data-order-id="${line.orderId}">出貨</button>
            </div>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="11">目前沒有訂單。</td></tr>`;
}

function renderInventory() {
  const rows = state.items.map(inventoryForItem).sort((a, b) => b.needQty - a.needQty);
  $("#inventory-table").innerHTML =
    rows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.activityName)}</td>
          <td>${escapeHtml(row.item.name)}</td>
          <td>${moneyless(row.orderedQty)}</td>
          <td>${moneyless(row.cancelledQty)}</td>
          <td>${moneyless(row.effectiveDemand)}</td>
          <td>${moneyless(row.shippedQty)}</td>
          <td>${moneyless(row.unshippedQty)}</td>
          <td>${moneyless(row.availableStock)}</td>
          <td>${moneyless(row.incomingPending)}</td>
          <td class="${row.needQty > 0 ? "number-strong" : ""}">${moneyless(row.needQty)}</td>
        </tr>`
      )
      .join("") || `<tr><td colspan="10">尚未建立品項。</td></tr>`;
}

function renderDisputes() {
  $("#disputes-table").innerHTML =
    state.disputes
      .map((dispute) => {
        const statusText = { open: "未處理", processing: "處理中", resolved: "已完成" }[dispute.status] || "未處理";
        return `<tr>
          <td><span class="badge ${dispute.isFlagged ? "shortage" : "ok"}">${dispute.isFlagged ? "已標記" : "已解除"}</span></td>
          <td>${escapeHtml(dispute.memberCode)}</td>
          <td>${escapeHtml(dispute.customerName)}</td>
          <td>${escapeHtml(dispute.reason)}</td>
          <td>${statusText}</td>
          <td>${escapeHtml(dispute.date)}</td>
          <td>
            <div class="row-actions">
              <button data-edit-dispute="${dispute.id}">修改</button>
              <button data-toggle-dispute="${dispute.id}">${dispute.isFlagged ? "解除" : "標記"}</button>
            </div>
          </td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="7">尚無客訴或爭議紀錄。</td></tr>`;
}

function renderItems() {
  $("#items-table").innerHTML =
    state.items
      .map(
        (item) => `<tr>
          <td>${escapeHtml(activityName(item.activityId))}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${moneyless(item.initialStock)}</td>
          <td>${moneyless(item.incomingPending)}</td>
          <td>${moneyless(item.stockAdjustment)}</td>
          <td>${escapeHtml(item.note || "")}</td>
          <td><button class="secondary" data-edit-item="${item.id}">編輯</button></td>
        </tr>`
      )
      .join("") || `<tr><td colspan="7">尚未建立品項。</td></tr>`;
}

function renderActivities() {
  $("#activities-table").innerHTML =
    state.activities
      .map((activity) => {
        const usage = activityUsage(activity.id);
        return `<tr>
          <td>${escapeHtml(activity.name)}</td>
          <td>${moneyless(usage.itemIds.length)}</td>
          <td>${moneyless(usage.lines.length)}</td>
          <td>${escapeHtml(activity.note || "")}</td>
          <td><button class="danger" data-delete-activity="${activity.id}">刪除</button></td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="5">尚未建立活動。</td></tr>`;
}

function renderSources() {
  $("#sources-table").innerHTML =
    (state.sources || [])
      .map(
        (source) => `<tr>
          <td>${escapeHtml(source.name)}</td>
          <td>${escapeHtml(source.note || "")}</td>
          <td>${escapeHtml((source.createdAt || "").slice(0, 10))}</td>
        </tr>`
      )
      .join("") || `<tr><td colspan="3">尚未建立訂單來源。</td></tr>`;
}

function renderAll(options = {}) {
  if (!options.skipSave) saveState();
  renderSelects();
  renderDashboard();
  renderOrders();
  renderInventory();
  renderDisputes();
  renderItems();
  renderActivities();
  renderSources();
  updateCloudUi();
}

function showView(viewName) {
  $$(".view").forEach((view) => view.classList.remove("active"));
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  $(`#${viewName}-view`).classList.add("active");
}

function activeDisputeWarnings(customerName, memberCode) {
  const exact = state.disputes.filter((dispute) => dispute.isFlagged && dispute.memberCode === memberCode);
  const possible = state.disputes.filter(
    (dispute) => dispute.isFlagged && dispute.customerName === customerName && dispute.memberCode !== memberCode
  );
  return { exact, possible };
}

function showOrderWarnings() {
  const customerName = $("#order-customer").value.trim();
  const memberCode = $("#order-member").value.trim();
  const box = $("#order-warning");
  if (!customerName && !memberCode) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  const { exact, possible } = activeDisputeWarnings(customerName, memberCode);
  const messages = [];
  if (exact.length) messages.push("此會員代號有爭議紀錄，請先查看客訴與爭議頁。");
  if (possible.length) messages.push("姓名相同但會員代號不同，可能為同一人，請確認。");
  box.textContent = messages.join(" ");
  box.classList.toggle("hidden", messages.length === 0);
}

function addHistory(orderId, orderLineId, type, beforeValue, afterValue, note = "") {
  state.history.push({ id: uid(), orderId, orderLineId, type, beforeValue, afterValue, note, createdAt: now() });
}

function findOrderLine(orderId) {
  const order = state.orders.find((entry) => entry.id === orderId);
  return { order, line: order?.lines[0] };
}

function handleOrderSubmit(event) {
  event.preventDefault();
  const orderId = $("#order-id").value;
  const payload = {
    customerName: $("#order-customer").value.trim(),
    memberCode: $("#order-member").value.trim(),
    activityId: $("#order-activity").value,
    itemId: $("#order-item").value,
    sourceId: $("#order-source").value,
    orderedQty: toInt($("#order-qty").value),
    note: $("#order-note").value.trim()
  };
  if (!payload.customerName || !payload.memberCode || !payload.activityId || !payload.itemId || payload.orderedQty < 1) return;

  if (orderId) {
    const { order, line } = findOrderLine(orderId);
    const before = JSON.stringify({ order, line });
    order.customerName = payload.customerName;
    order.memberCode = payload.memberCode;
    order.sourceId = payload.sourceId;
    order.note = payload.note;
    order.updatedAt = now();
    line.activityId = payload.activityId;
    line.itemId = payload.itemId;
    line.orderedQty = payload.orderedQty;
    line.updatedAt = now();
    if (line.cancelledQty > line.orderedQty) line.cancelledQty = line.orderedQty;
    if (line.shippedQty > line.orderedQty - line.cancelledQty) line.shippedQty = Math.max(line.orderedQty - line.cancelledQty, 0);
    addHistory(order.id, line.id, "edit", before, JSON.stringify({ order, line }), "手動修改訂單");
  } else {
    const id = uid();
    const lineId = uid();
    state.orders.push({
      id,
      customerName: payload.customerName,
      memberCode: payload.memberCode,
      sourceId: payload.sourceId,
      note: payload.note,
      lines: [
        {
          id: lineId,
          activityId: payload.activityId,
          itemId: payload.itemId,
          orderedQty: payload.orderedQty,
          cancelledQty: 0,
          shippedQty: 0
        }
      ],
      createdAt: now(),
      updatedAt: now()
    });
    addHistory(id, lineId, "create", "", JSON.stringify(payload), "新增訂單");
  }
  event.target.reset();
  $("#order-id").value = "";
  $("#order-warning").classList.add("hidden");
  renderAll();
}

function handleReceiptSubmit(event) {
  event.preventDefault();
  const itemId = $("#receipt-item").value;
  const qty = toInt($("#receipt-qty").value);
  if (!itemId || qty < 1) return;
  state.receipts.push({
    id: uid(),
    activityId: $("#receipt-activity").value,
    itemId,
    receivedQty: qty,
    date: today(),
    note: $("#receipt-note").value.trim(),
    createdAt: now()
  });
  event.target.reset();
  renderAll();
}

function shipOrder(orderId, qty, note) {
  const { order, line } = findOrderLine(orderId);
  if (!order || !line) return { ok: false, message: "找不到訂單。" };
  const inv = inventoryForItem(itemById(line.itemId));
  const unshipped = Math.max(line.orderedQty - line.cancelledQty - line.shippedQty, 0);
  if (qty > unshipped) return { ok: false, message: `出貨數量不可超過此訂單未出貨數量 ${unshipped}。` };
  if (qty > inv.availableStock) return { ok: false, message: `可用庫存只有 ${inv.availableStock}，不能出貨 ${qty}。` };
  const before = line.shippedQty;
  line.shippedQty += qty;
  order.updatedAt = now();
  state.shipments.push({ id: uid(), orderId, itemId: line.itemId, shippedQty: qty, date: today(), note, createdAt: now() });
  addHistory(orderId, line.id, "ship", before, line.shippedQty, note);
  return { ok: true };
}

function handleShipmentSubmit(event) {
  event.preventDefault();
  const result = shipOrder($("#shipment-order").value, toInt($("#shipment-qty").value), $("#shipment-note").value.trim());
  if (!result.ok) {
    alert(result.message);
    return;
  }
  event.target.reset();
  renderAll();
}

function handleLineActionSubmit(event) {
  event.preventDefault();
  const type = $("#line-action-type").value;
  const orderId = $("#line-action-order-id").value;
  const qty = toInt($("#line-action-qty").value);
  const note = $("#line-action-note").value.trim();
  const { order, line } = findOrderLine(orderId);
  if (!order || !line || qty < 1) return;

  if (type === "cancel") {
    const cancellable = Math.max(line.orderedQty - line.cancelledQty - line.shippedQty, 0);
    if (qty > cancellable) {
      alert(`可取消數量只有 ${cancellable}。`);
      return;
    }
    const before = line.cancelledQty;
    line.cancelledQty += qty;
    order.updatedAt = now();
    addHistory(orderId, line.id, "cancel", before, line.cancelledQty, note);
  }

  if (type === "ship") {
    const result = shipOrder(orderId, qty, note);
    if (!result.ok) {
      alert(result.message);
      return;
    }
  }

  $("#line-action-dialog").close();
  event.target.reset();
  renderAll();
}

function handleDisputeSubmit(event) {
  event.preventDefault();
  const id = $("#dispute-id").value;
  const payload = {
    memberCode: $("#dispute-member").value.trim(),
    customerName: $("#dispute-customer").value.trim(),
    relatedOrderId: $("#dispute-order").value,
    status: $("#dispute-status").value,
    isFlagged: $("#dispute-flagged").checked,
    reason: $("#dispute-reason").value.trim(),
    note: $("#dispute-note").value.trim()
  };
  if (!payload.memberCode || !payload.customerName || !payload.reason) return;
  if (id) {
    const dispute = state.disputes.find((entry) => entry.id === id);
    Object.assign(dispute, payload, { updatedAt: now() });
  } else {
    state.disputes.push({ ...payload, id: uid(), date: today(), createdAt: now(), updatedAt: now() });
  }
  event.target.reset();
  $("#dispute-id").value = "";
  $("#dispute-flagged").checked = true;
  renderAll();
}

function handleActivitySubmit(event) {
  event.preventDefault();
  const name = $("#activity-name").value.trim();
  if (!name) return;
  if (state.activities.some((activity) => activity.name === name)) {
    alert("這個活動名稱已經存在。");
    return;
  }
  state.activities.push({
    id: uid(),
    name,
    note: $("#activity-note").value.trim(),
    createdAt: now(),
    updatedAt: now()
  });
  event.target.reset();
  renderAll();
}

function parseLotteryLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\S+)\s+(.+?)\s+(\d+)$/);
  if (!match) return { error: `無法解析「${trimmed}」` };
  return {
    prize: match[1],
    name: match[2].trim(),
    qty: toInt(match[3])
  };
}

function handleLotterySubmit(event) {
  event.preventDefault();
  const resultBox = $("#lottery-result");
  const activityNameValue = $("#lottery-activity-name").value.trim();
  const total = toInt($("#lottery-total").value);
  const lastPrizeName = $("#lottery-last-prize").value.trim();
  const parsedLines = $("#lottery-lines")
    .value.split(/\r?\n/)
    .map(parseLotteryLine)
    .filter(Boolean);
  const errors = parsedLines.filter((line) => line.error).map((line) => line.error);
  const items = parsedLines.filter((line) => !line.error);
  const itemTotal = items.reduce((sum, item) => sum + item.qty, 0);
  if (!activityNameValue) errors.push("請輸入活動名稱");
  if (state.activities.some((activity) => activity.name === activityNameValue)) errors.push("這個活動名稱已經存在");
  if (total < 1) errors.push("總抽數需大於 0");
  if (!items.length) errors.push("請至少輸入一個賞別配置");
  if (items.some((item) => item.qty < 1)) errors.push("每個賞別數量都需大於 0");
  if (itemTotal !== total) errors.push(`一般賞數量合計 ${itemTotal}，與總抽數 ${total} 不一致。最後賞不列入總抽數`);
  if (errors.length) {
    resultBox.textContent = errors.join("。");
    resultBox.className = "result-box error";
    return;
  }

  const activityId = uid();
  const asPending = document.querySelector('input[name="lottery-stock-mode"]:checked')?.value === "pending";
  state.activities.push({
    id: activityId,
    name: activityNameValue,
    note: `一番賞配置，總抽數 ${total}`,
    createdAt: now(),
    updatedAt: now()
  });
  const createdItems = [...items];
  if (lastPrizeName) createdItems.push({ prize: "最後賞", name: lastPrizeName.replace(/^最後賞\s*/, ""), qty: 1, isLastPrize: true });
  createdItems.forEach((item) => {
    state.items.push({
      id: uid(),
      activityId,
      name: `${item.prize} ${item.name}`,
      initialStock: asPending ? 0 : item.qty,
      incomingPending: asPending ? item.qty : 0,
      stockAdjustment: 0,
      note: item.isLastPrize ? "最後賞，不列入總抽數" : `配置 ${item.qty} 抽`,
      createdAt: now(),
      updatedAt: now()
    });
  });
  event.target.reset();
  document.querySelector('input[name="lottery-stock-mode"][value="stock"]').checked = true;
  resultBox.textContent = `已建立「${activityNameValue}」與 ${createdItems.length} 個品項${lastPrizeName ? "，包含最後賞" : ""}，配置數量已${asPending ? "放入待到貨" : "列入可用庫存"}。`;
  resultBox.className = "result-box ok";
  renderAll();
}

function openDeleteActivityDialog(activityId) {
  const activity = state.activities.find((entry) => entry.id === activityId);
  if (!activity) return;
  const usage = activityUsage(activityId);
  pendingActivityDeleteCode = String(Math.floor(100000 + Math.random() * 900000));
  $("#delete-activity-id").value = activityId;
  $("#delete-activity-message").textContent = `將刪除「${activity.name}」，並移除 ${usage.itemIds.length} 個品項、${usage.lines.length} 筆訂單明細、${usage.receipts.length} 筆收貨、${usage.shipments.length} 筆出貨紀錄。此操作無法復原。`;
  $("#delete-activity-code").textContent = pendingActivityDeleteCode;
  $("#delete-activity-confirm").value = "";
  $("#delete-activity-error").classList.add("hidden");
  $("#delete-activity-error").textContent = "";
  $("#delete-activity-dialog").showModal();
}

function deleteActivity(activityId) {
  const usage = activityUsage(activityId);
  const itemIdSet = new Set(usage.itemIds);
  const removedOrderIds = new Set();
  state.activities = state.activities.filter((activity) => activity.id !== activityId);
  state.items = state.items.filter((item) => item.activityId !== activityId);
  state.receipts = state.receipts.filter((receipt) => receipt.activityId !== activityId && !itemIdSet.has(receipt.itemId));
  state.shipments = state.shipments.filter((shipment) => !itemIdSet.has(shipment.itemId));
  state.orders = state.orders
    .map((order) => {
      const lines = order.lines.filter((line) => line.activityId !== activityId && !itemIdSet.has(line.itemId));
      if (!lines.length) removedOrderIds.add(order.id);
      return { ...order, lines, updatedAt: now() };
    })
    .filter((order) => order.lines.length);
  state.disputes = state.disputes.map((dispute) =>
    removedOrderIds.has(dispute.relatedOrderId) ? { ...dispute, relatedOrderId: "", updatedAt: now() } : dispute
  );
  state.history.push({
    id: uid(),
    orderId: "",
    orderLineId: "",
    type: "delete_activity",
    beforeValue: activityId,
    afterValue: "",
    note: "刪除活動與相關資料",
    createdAt: now()
  });
}

function handleItemSubmit(event) {
  event.preventDefault();
  state.items.push({
    id: uid(),
    activityId: $("#item-activity").value,
    name: $("#item-name").value.trim(),
    initialStock: toInt($("#item-initial").value),
    incomingPending: toInt($("#item-pending").value),
    stockAdjustment: signedInt($("#item-adjustment").value),
    note: $("#item-note").value.trim(),
    createdAt: now(),
    updatedAt: now()
  });
  event.target.reset();
  $("#item-initial").value = 0;
  $("#item-pending").value = 0;
  $("#item-adjustment").value = 0;
  renderAll();
}

function handleSourceSubmit(event) {
  event.preventDefault();
  const name = $("#source-name").value.trim();
  if (!name) return;
  const existing = state.sources.find((source) => source.name === name);
  if (existing) {
    alert("這個來源名稱已經存在。");
    return;
  }
  state.sources.push({
    id: uid(),
    name,
    note: $("#source-note").value.trim(),
    createdAt: now(),
    updatedAt: now()
  });
  event.target.reset();
  renderAll();
}

function parseCsv(text) {
  const rows = [];
  let current = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      current.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else {
      field += char;
    }
  }
  current.push(field);
  rows.push(current);
  return rows.filter((row) => row.some((cell) => cell.trim()));
}

const CSV_FIELD_ALIASES = {
  customerName: ["customerName", "客人姓名", "姓名", "客戶姓名"],
  memberCode: ["memberCode", "會員代號", "會員編號", "會員ID"],
  sourceName: ["sourceName", "來源", "訂單來源", "平台"],
  activityName: ["activityName", "活動名稱", "活動", "賞池"],
  itemName: ["itemName", "商品名稱", "品項名稱", "商品或賞別", "賞別"],
  quantity: ["quantity", "orderedQty", "訂購數量", "數量"],
  cancelledQty: ["cancelledQty", "取消數量"],
  shippedQty: ["shippedQty", "已出貨數量"],
  note: ["note", "備註"]
};

function normalizeCsvRecord(record) {
  return Object.fromEntries(
    Object.entries(CSV_FIELD_ALIASES).map(([field, aliases]) => [
      field,
      aliases.map((alias) => record[alias]).find((value) => value) || ""
    ])
  );
}

function importOrdersCsv(text, defaultSourceId = "") {
  const rows = parseCsv(text);
  const headers = rows.shift().map((header) => header.trim());
  const result = { added: 0, warnings: [] };
  rows.forEach((row, index) => {
    const rawRecord = Object.fromEntries(headers.map((header, cellIndex) => [header, row[cellIndex]?.trim() || ""]));
    const record = normalizeCsvRecord(rawRecord);
    const activity = state.activities.find((entry) => entry.name === record.activityName);
    const item = state.items.find((entry) => entry.activityId === activity?.id && entry.name === record.itemName);
    const source = state.sources.find((entry) => entry.name === record.sourceName);
    const quantity = toInt(record.quantity);
    const cancelledQty = toInt(record.cancelledQty);
    const shippedQty = toInt(record.shippedQty);
    const errors = [];
    if (!record.customerName) errors.push("缺少客人姓名");
    if (!record.memberCode) errors.push("缺少會員代號");
    if (!record.activityName) errors.push("缺少活動名稱");
    if (record.activityName && !activity) errors.push(`找不到活動「${record.activityName}」`);
    if (!record.itemName) errors.push("缺少商品名稱");
    if (record.itemName && activity && !item) errors.push(`找不到品項「${record.itemName}」`);
    if (quantity < 1) errors.push("訂購數量需大於 0");
    if (cancelledQty > quantity) errors.push("取消數量不可大於訂購數量");
    if (shippedQty > quantity - cancelledQty) errors.push("已出貨數量不可大於有效需求");
    if (errors.length) {
      result.warnings.push(`第 ${index + 2} 列略過：${errors.join("、")}。`);
      return;
    }
    const warnings = activeDisputeWarnings(record.customerName, record.memberCode);
    if (warnings.exact.length) result.warnings.push(`第 ${index + 2} 列：會員 ${record.memberCode} 有爭議紀錄。`);
    if (warnings.possible.length) result.warnings.push(`第 ${index + 2} 列：姓名 ${record.customerName} 可能為同一人，請確認。`);
    if (record.sourceName && !source) result.warnings.push(`第 ${index + 2} 列：找不到來源「${record.sourceName}」，已使用匯入預設來源。`);
    const orderId = uid();
    const lineId = uid();
    state.orders.push({
      id: orderId,
      customerName: record.customerName,
      memberCode: record.memberCode,
      sourceId: source?.id || defaultSourceId,
      note: record.note || "",
      lines: [{ id: lineId, activityId: activity.id, itemId: item.id, orderedQty: quantity, cancelledQty, shippedQty }],
      createdAt: now(),
      updatedAt: now()
    });
    addHistory(orderId, lineId, "create", "", JSON.stringify(record), "CSV 匯入");
    result.added += 1;
  });
  return result;
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportInventory() {
  const headers = ["activityName", "itemName", "orderedQty", "cancelledQty", "effectiveDemand", "shippedQty", "unshippedQty", "availableStock", "incomingPending", "needQty"];
  const lines = state.items.map(inventoryForItem).map((row) =>
    [
      row.activityName,
      row.item.name,
      row.orderedQty,
      row.cancelledQty,
      row.effectiveDemand,
      row.shippedQty,
      row.unshippedQty,
      row.availableStock,
      row.incomingPending,
      row.needQty
    ]
      .map(csvEscape)
      .join(",")
  );
  download(`inventory-${today()}.csv`, [headers.join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
}

function exportOrders() {
  const headers = ["customerName", "memberCode", "sourceName", "activityName", "itemName", "orderedQty", "cancelledQty", "shippedQty", "note"];
  const lines = allLines().map((line) => {
    const order = state.orders.find((entry) => entry.id === line.orderId);
    return [
      line.customerName,
      line.memberCode,
      sourceName(line.sourceId),
      activityName(line.activityId),
      itemName(line.itemId),
      line.orderedQty,
      line.cancelledQty,
      line.shippedQty,
      order?.note || ""
    ]
      .map(csvEscape)
      .join(",");
  });
  download(`orders-${today()}.csv`, [headers.join(","), ...lines].join("\n"), "text/csv;charset=utf-8");
}

function bindEvents() {
  $$(".nav-btn").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$("[data-open-view]").forEach((button) =>
    button.addEventListener("click", () => {
      showView(button.dataset.openView);
      const target = button.dataset.focusPanel === "receipt" ? $("#receipt-form") : $("#shipment-form");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    })
  );

  $("#order-form").addEventListener("submit", handleOrderSubmit);
  $("#receipt-form").addEventListener("submit", handleReceiptSubmit);
  $("#shipment-form").addEventListener("submit", handleShipmentSubmit);
  $("#line-action-form").addEventListener("submit", handleLineActionSubmit);
  $("#dispute-form").addEventListener("submit", handleDisputeSubmit);
  $("#activity-form").addEventListener("submit", handleActivitySubmit);
  $("#lottery-form").addEventListener("submit", handleLotterySubmit);
  $("#item-form").addEventListener("submit", handleItemSubmit);
  $("#source-form").addEventListener("submit", handleSourceSubmit);
  $("#cloud-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    saveCloudSettings({
      url: $("#cloud-url").value.trim(),
      anonKey: $("#cloud-key").value.trim()
    });
    setCloudResult("設定已儲存，正在讀取登入狀態...", "neutral");
    await initCloudSync();
  });
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInWithEmail($("#auth-email").value.trim(), $("#auth-password").value);
  });
  $("#gate-auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await signInWithEmail($("#gate-auth-email").value.trim(), $("#gate-auth-password").value);
  });

  $("#order-activity").addEventListener("change", renderSelects);
  $("#receipt-activity").addEventListener("change", renderSelects);
  $("#order-customer").addEventListener("input", showOrderWarnings);
  $("#order-member").addEventListener("input", showOrderWarnings);

  ["#dashboard-activity-filter", "#dashboard-status-filter", "#dashboard-search"].forEach((selector) =>
    $(selector).addEventListener("input", renderDashboard)
  );
  ["#order-search", "#order-status-filter", "#order-source-filter"].forEach((selector) => $(selector).addEventListener("input", renderOrders));

  $("#reset-order-form").addEventListener("click", () => {
    $("#order-form").reset();
    $("#order-id").value = "";
    $("#order-warning").classList.add("hidden");
  });
  $("#reset-dispute-form").addEventListener("click", () => {
    $("#dispute-form").reset();
    $("#dispute-id").value = "";
    $("#dispute-flagged").checked = true;
  });
  $("#fill-lottery-example").addEventListener("click", () => {
    $("#lottery-activity-name").value = "死神一番賞第 1 彈";
    $("#lottery-total").value = 80;
    $("#lottery-lines").value = ["A賞 一護模型 2", "B賞 劍八模型 3", "C賞 夜一模型 5", "D賞 代理證模型 10", "E賞 壓克力立牌 20", "F賞 小卡 40"].join("\n");
    $("#lottery-last-prize").value = "一護特別色模型";
    document.querySelector('input[name="lottery-stock-mode"][value="stock"]').checked = true;
    $("#lottery-result").textContent = "範例已填入，可直接改成你的實際配置。";
    $("#lottery-result").className = "result-box neutral";
  });
  $("#close-line-dialog").addEventListener("click", () => $("#line-action-dialog").close());
  $("#close-delete-activity-dialog").addEventListener("click", () => $("#delete-activity-dialog").close());
  $("#delete-activity-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("#delete-activity-confirm").value.trim() !== pendingActivityDeleteCode) {
      $("#delete-activity-error").textContent = "安全碼不正確，請重新輸入。";
      $("#delete-activity-error").classList.remove("hidden");
      return;
    }
    deleteActivity($("#delete-activity-id").value);
    pendingActivityDeleteCode = "";
    $("#delete-activity-dialog").close();
    renderAll();
  });

  document.addEventListener("click", (event) => {
    const deleteActivityButton = event.target.closest("[data-delete-activity]");
    if (deleteActivityButton) {
      openDeleteActivityDialog(deleteActivityButton.dataset.deleteActivity);
    }

    const editOrder = event.target.closest("[data-edit-order]");
    if (editOrder) {
      const { order, line } = findOrderLine(editOrder.dataset.editOrder);
      $("#order-id").value = order.id;
      $("#order-customer").value = order.customerName;
      $("#order-member").value = order.memberCode;
      $("#order-source").value = order.sourceId || "";
      $("#order-activity").value = line.activityId;
      renderSelects();
      $("#order-source").value = order.sourceId || "";
      $("#order-item").value = line.itemId;
      $("#order-qty").value = line.orderedQty;
      $("#order-note").value = order.note || "";
      showView("orders");
      $("#order-customer").focus();
    }

    const actionButton = event.target.closest("[data-action-line]");
    if (actionButton) {
      const { order, line } = findOrderLine(actionButton.dataset.orderId);
      const type = actionButton.dataset.actionLine;
      const effective = Math.max(line.orderedQty - line.cancelledQty, 0);
      const unshipped = Math.max(effective - line.shippedQty, 0);
      $("#line-action-order-id").value = order.id;
      $("#line-action-type").value = type;
      $("#line-action-title").textContent = type === "cancel" ? "部分取消" : "部分出貨";
      $("#line-action-context").textContent = `${order.customerName}｜${activityName(line.activityId)}｜${itemName(line.itemId)}｜目前未出貨 ${unshipped}`;
      $("#line-action-qty").value = "";
      $("#line-action-note").value = "";
      $("#line-action-dialog").showModal();
    }

    const editDispute = event.target.closest("[data-edit-dispute]");
    if (editDispute) {
      const dispute = state.disputes.find((entry) => entry.id === editDispute.dataset.editDispute);
      $("#dispute-id").value = dispute.id;
      $("#dispute-member").value = dispute.memberCode;
      $("#dispute-customer").value = dispute.customerName;
      $("#dispute-order").value = dispute.relatedOrderId || "";
      $("#dispute-status").value = dispute.status;
      $("#dispute-flagged").checked = dispute.isFlagged;
      $("#dispute-reason").value = dispute.reason;
      $("#dispute-note").value = dispute.note || "";
    }

    const toggleDispute = event.target.closest("[data-toggle-dispute]");
    if (toggleDispute) {
      const dispute = state.disputes.find((entry) => entry.id === toggleDispute.dataset.toggleDispute);
      dispute.isFlagged = !dispute.isFlagged;
      if (!dispute.isFlagged) dispute.status = "resolved";
      dispute.updatedAt = now();
      renderAll();
    }

    const editItem = event.target.closest("[data-edit-item]");
    if (editItem) {
      const item = itemById(editItem.dataset.editItem);
      const initialStock = prompt("期初庫存", item.initialStock);
      if (initialStock === null) return;
      const pending = prompt("待到貨", item.incomingPending);
      if (pending === null) return;
      const adjustment = prompt("庫存調整（可正可負）", item.stockAdjustment);
      if (adjustment === null) return;
      item.initialStock = toInt(initialStock);
      item.incomingPending = toInt(pending);
      item.stockAdjustment = signedInt(adjustment);
      item.updatedAt = now();
      renderAll();
    }
  });

  $("#import-orders").addEventListener("click", async () => {
    const file = $("#csv-file").files[0];
    if (!file) return;
    const result = importOrdersCsv(await file.text(), $("#import-source").value);
    $("#import-result").innerHTML = `已匯入 ${result.added} 筆訂單。${result.warnings.length ? `<br>${result.warnings.map(escapeHtml).join("<br>")}` : ""}`;
    renderAll();
  });

  $("#export-inventory").addEventListener("click", exportInventory);
  $("#export-orders").addEventListener("click", exportOrders);
  $("#export-backup").addEventListener("click", () =>
    download(`beartoys-backup-${today()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8")
  );
  $("#backup-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state = JSON.parse(await file.text());
    renderAll();
  });
  $("#clear-data").addEventListener("click", () => {
    if (!confirm("確定要清除本機展示資料並恢復範例資料？")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = seedState();
    renderAll();
  });
  $("#pull-cloud").addEventListener("click", async () => {
    if (!confirm("會用雲端資料覆蓋目前本機資料，確定要下載？")) return;
    await pullCloudState();
  });
  $("#push-cloud").addEventListener("click", async () => {
    if (!confirm("會用目前本機資料覆蓋雲端資料，確定要上傳？")) return;
    await pushCloudState();
  });
  $("#disable-cloud").addEventListener("click", async () => {
    if (!confirm("會登出並還原程式內建的 Supabase 連線設定，雲端資料不會被刪除。確定繼續？")) return;
    localStorage.removeItem(CLOUD_CONFIG_KEY);
    cloudSettings = { ...DEFAULT_CLOUD_SETTINGS };
    cloudUser = null;
    if (cloudAuthSubscription) {
      cloudAuthSubscription.unsubscribe();
      cloudAuthSubscription = null;
    }
    cloudClient = null;
    await initCloudSync({ pullRemote: false });
    setCloudResult("已還原預設連線設定，請重新登入。", "neutral");
  });
  $("#auth-login").addEventListener("click", async () => {
    await signInWithEmail($("#auth-email").value.trim(), $("#auth-password").value);
  });
  $("#auth-signup").addEventListener("click", async () => {
    await signUpWithEmail($("#auth-email").value.trim(), $("#auth-password").value);
  });
  $("#auth-logout").addEventListener("click", async () => {
    await signOut();
  });
}

bindEvents();
initCloudSync();
updateCloudUi();
