const STORAGE_KEY = "beartoys-prize-manager-v1";
const CLOUD_CONFIG_KEY = "beartoys-prize-manager-cloud-config-v1";

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

function seedState() {
  const activityA = uid();
  const activityB = uid();
  const itemA = uid();
  const itemB = uid();
  const itemC = uid();
  const orderA = uid();
  const orderB = uid();
  const orderC = uid();

  return {
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
        note: "",
        lines: [{ id: uid(), activityId: activityA, itemId: itemA, orderedQty: 100, cancelledQty: 10, shippedQty: 30 }],
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: orderB,
        customerName: "陳先生",
        memberCode: "BT002",
        note: "",
        lines: [{ id: uid(), activityId: activityA, itemId: itemB, orderedQty: 6, cancelledQty: 0, shippedQty: 2 }],
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: orderC,
        customerName: "王小美",
        memberCode: "BT999",
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
    return { ...seedState(), ...JSON.parse(stored) };
  } catch {
    return seedState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueCloudSave();
}

function loadCloudSettings() {
  const stored = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (!stored) return { url: "", anonKey: "" };
  try {
    return { url: "", anonKey: "", ...JSON.parse(stored) };
  } catch {
    return { url: "", anonKey: "" };
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
  const box = $("#cloud-result");
  if (!box) return;
  box.textContent = message;
  box.className = `result-box ${type}`;
}

function setAuthStatus(message, type = "neutral") {
  const box = $("#auth-status");
  if (!box) return;
  box.textContent = message;
  box.className = `result-box ${type}`;
}

function setStorageNote(message) {
  const note = $("#storage-note");
  if (note) note.textContent = message;
}

function updateCloudUi() {
  const urlInput = $("#cloud-url");
  const keyInput = $("#cloud-key");
  if (urlInput) urlInput.value = cloudSettings.url || "";
  if (keyInput) keyInput.value = cloudSettings.anonKey || "";
  setAuthStatus(cloudUser ? `已登入：${cloudUser.email || cloudUser.id}` : "尚未登入。", cloudUser ? "ok" : "neutral");
  setStorageNote(
    cloudClient && cloudUser
      ? "資料已啟用 Supabase 雲端同步，同時保留本機備份"
      : "展示版資料儲存在本機瀏覽器 localStorage"
  );
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
    updateCloudUi();
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
    if (cloudUser) await pullCloudState({ quietIfEmpty: true });
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
  if (!pulled) await pushCloudState({ quiet: true });
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

  state = { ...seedState(), ...data.data };
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

function activityName(id) {
  return state.activities.find((activity) => activity.id === id)?.name || "未設定活動";
}

function itemName(id) {
  return state.items.find((item) => item.id === id)?.name || "未設定品項";
}

function itemById(id) {
  return state.items.find((item) => item.id === id);
}

function allLines() {
  return state.orders.flatMap((order) =>
    order.lines.map((line) => ({ ...line, orderId: order.id, customerName: order.customerName, memberCode: order.memberCode }))
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
  const rows = allLines()
    .map((line) => ({ ...line, status: lineStatus(line) }))
    .filter((line) => statusFilter === "all" || line.status.key === statusFilter)
    .filter((line) => {
      const text = `${line.customerName} ${line.memberCode} ${activityName(line.activityId)} ${itemName(line.itemId)}`.toLowerCase();
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
      .join("") || `<tr><td colspan="10">目前沒有訂單。</td></tr>`;
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

function renderAll(options = {}) {
  if (!options.skipSave) saveState();
  renderSelects();
  renderDashboard();
  renderOrders();
  renderInventory();
  renderDisputes();
  renderItems();
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
    orderedQty: toInt($("#order-qty").value),
    note: $("#order-note").value.trim()
  };
  if (!payload.customerName || !payload.memberCode || !payload.activityId || !payload.itemId || payload.orderedQty < 1) return;

  if (orderId) {
    const { order, line } = findOrderLine(orderId);
    const before = JSON.stringify({ order, line });
    order.customerName = payload.customerName;
    order.memberCode = payload.memberCode;
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
  state.activities.push({
    id: uid(),
    name: $("#activity-name").value.trim(),
    note: $("#activity-note").value.trim(),
    createdAt: now(),
    updatedAt: now()
  });
  event.target.reset();
  renderAll();
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

function importOrdersCsv(text) {
  const rows = parseCsv(text);
  const headers = rows.shift().map((header) => header.trim());
  const result = { added: 0, warnings: [] };
  rows.forEach((row, index) => {
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, row[cellIndex]?.trim() || ""]));
    const activity = state.activities.find((entry) => entry.name === record.activityName);
    const item = state.items.find((entry) => entry.activityId === activity?.id && entry.name === record.itemName);
    const quantity = toInt(record.quantity);
    if (!record.customerName || !record.memberCode || !activity || !item || quantity < 1) {
      result.warnings.push(`第 ${index + 2} 列略過：資料不完整、活動/品項不存在或數量錯誤。`);
      return;
    }
    const warnings = activeDisputeWarnings(record.customerName, record.memberCode);
    if (warnings.exact.length) result.warnings.push(`第 ${index + 2} 列：會員 ${record.memberCode} 有爭議紀錄。`);
    if (warnings.possible.length) result.warnings.push(`第 ${index + 2} 列：姓名 ${record.customerName} 可能為同一人，請確認。`);
    const orderId = uid();
    const lineId = uid();
    state.orders.push({
      id: orderId,
      customerName: record.customerName,
      memberCode: record.memberCode,
      note: record.note || "",
      lines: [{ id: lineId, activityId: activity.id, itemId: item.id, orderedQty: quantity, cancelledQty: 0, shippedQty: 0 }],
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
  const headers = ["customerName", "memberCode", "activityName", "itemName", "orderedQty", "cancelledQty", "shippedQty", "note"];
  const lines = allLines().map((line) => {
    const order = state.orders.find((entry) => entry.id === line.orderId);
    return [line.customerName, line.memberCode, activityName(line.activityId), itemName(line.itemId), line.orderedQty, line.cancelledQty, line.shippedQty, order?.note || ""]
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
  $("#item-form").addEventListener("submit", handleItemSubmit);
  $("#cloud-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    saveCloudSettings({
      url: $("#cloud-url").value.trim(),
      anonKey: $("#cloud-key").value.trim()
    });
    setCloudResult("設定已儲存，正在讀取登入狀態...", "neutral");
    await initCloudSync();
  });
  $("#auth-form").addEventListener("submit", (event) => event.preventDefault());

  $("#order-activity").addEventListener("change", renderSelects);
  $("#receipt-activity").addEventListener("change", renderSelects);
  $("#order-customer").addEventListener("input", showOrderWarnings);
  $("#order-member").addEventListener("input", showOrderWarnings);

  ["#dashboard-activity-filter", "#dashboard-status-filter", "#dashboard-search"].forEach((selector) =>
    $(selector).addEventListener("input", renderDashboard)
  );
  ["#order-search", "#order-status-filter"].forEach((selector) => $(selector).addEventListener("input", renderOrders));

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
  $("#close-line-dialog").addEventListener("click", () => $("#line-action-dialog").close());

  document.addEventListener("click", (event) => {
    const editOrder = event.target.closest("[data-edit-order]");
    if (editOrder) {
      const { order, line } = findOrderLine(editOrder.dataset.editOrder);
      $("#order-id").value = order.id;
      $("#order-customer").value = order.customerName;
      $("#order-member").value = order.memberCode;
      $("#order-activity").value = line.activityId;
      renderSelects();
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
    const result = importOrdersCsv(await file.text());
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
  $("#disable-cloud").addEventListener("click", () => {
    if (!confirm("停用後只會使用本機 localStorage，雲端資料不會被刪除。確定停用？")) return;
    localStorage.removeItem(CLOUD_CONFIG_KEY);
    cloudSettings = { url: "", anonKey: "" };
    cloudUser = null;
    if (cloudAuthSubscription) {
      cloudAuthSubscription.unsubscribe();
      cloudAuthSubscription = null;
    }
    cloudClient = null;
    updateCloudUi();
    setCloudResult("已停用雲端同步。", "neutral");
  });
  $("#auth-login").addEventListener("click", async () => {
    if (!cloudClient) await initCloudSync({ pullRemote: false });
    if (!cloudClient) return;
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const { data, error } = await cloudClient.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthStatus(`登入失敗：${error.message}`, "error");
      return;
    }
    cloudUser = data.user;
    setAuthStatus(`已登入：${cloudUser.email}`, "ok");
    await pullCloudState({ quietIfEmpty: true });
    await pushCloudState({ quiet: true });
    updateCloudUi();
  });
  $("#auth-signup").addEventListener("click", async () => {
    if (!cloudClient) await initCloudSync({ pullRemote: false });
    if (!cloudClient) return;
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
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
    if (data.session) await pushCloudState({ quiet: true });
    updateCloudUi();
  });
  $("#auth-logout").addEventListener("click", async () => {
    if (!cloudClient) return;
    await cloudClient.auth.signOut();
    cloudUser = null;
    setAuthStatus("已登出。", "neutral");
    updateCloudUi();
  });
}

bindEvents();
renderAll();
initCloudSync();
