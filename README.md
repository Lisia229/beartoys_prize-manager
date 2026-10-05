# 抽賞訂單、收貨與出貨管理網站

第一版是純前端展示版，使用 HTML、SCSS、Vanilla JS 製作。

## 使用方式

直接開啟 `index.html` 即可使用。資料會存到同一台電腦、同一個瀏覽器的 `localStorage`，重新整理或關閉網頁後仍會保留。

## 第一版包含

- 訂單新增、修改、部分取消、部分出貨
- 收貨登記與可用庫存重新計算
- 活動與品項分開管理，同名品項不會跨活動混算
- 訂單來源／平台分類，例如 LINE 群組、線上平台 A、線上平台 B，並可自行新增來源
- 首頁缺貨總覽
- 客訴與爭議會員提醒
- 訂單 CSV 匯入
- 訂單與庫存統計 CSV 匯出
- 完整 JSON 備份與還原

## 缺貨計算

```text
有效需求 = 訂購總數 - 取消數量
尚未出貨 = 有效需求 - 已出貨數量
可用庫存 = 期初庫存 + 累計收貨 + 庫存調整 - 累計出貨
還需要收貨 = max(尚未出貨 - 可用庫存, 0)
```

待到貨會另外顯示，不會當成現有庫存。

## 正式版需要補上

- 登入與權限
- 後端 API
- 資料庫
- 自動備份
- 抽賞平台事件串接

## Supabase 正式雲端同步

目前已加入 Supabase Auth + RLS 雲端同步。這個版本先把整份資料存成 Supabase `app_state` 表中的一筆 JSON，並綁定登入者 `auth.uid()`。未登入者不能讀寫，其他帳號也不能讀寫你的資料。

在 Supabase SQL Editor 執行：

```sql
create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

revoke all on table public.app_state from anon, authenticated;
grant select, insert, update, delete on table public.app_state to authenticated;

drop policy if exists "Users can read own app state" on public.app_state;
drop policy if exists "Users can create own app state" on public.app_state;
drop policy if exists "Users can update own app state" on public.app_state;
drop policy if exists "Users can delete own app state" on public.app_state;

create policy "Users can read own app state"
on public.app_state for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create own app state"
on public.app_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update own app state"
on public.app_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete own app state"
on public.app_state for delete
to authenticated
using ((select auth.uid()) = user_id);
```

然後到網站的「雲端同步」分頁輸入：

- Supabase URL
- Supabase anon key
- Email
- 密碼

登入後按「上傳本機資料」即可把目前資料送上雲端。之後資料變更會自動同步，並同時保留本機備份。

未登入時網站只會顯示 Supabase 連線設定與登入頁，不會顯示後台管理畫面。登入成功後才會載入訂單、庫存、客訴與設定資料。正式使用建議先建立你和朋友的帳號，再到 Supabase Authentication 關閉公開註冊。

注意：這是單帳號正式版。若未來要多人共同管理、角色權限或平台 API 串接，建議再拆成 `activities`、`items`、`orders`、`order_lines`、`receipts`、`shipments`、`disputes` 等關聯式資料表。

## 訂單來源與 CSV

可以在「活動與品項」頁新增訂單來源／平台。訂單來源會用於手動新增訂單、CSV 匯入預設來源、訂單列表篩選與訂單匯出。

訂單 CSV 可使用欄位：

```text
customerName, memberCode, activityName, itemName, quantity, note, sourceName
```

若 CSV 沒有 `sourceName`，系統會使用匯入頁選擇的「匯入預設來源」。若 `sourceName` 有填，名稱需與系統內的來源名稱完全相同。
