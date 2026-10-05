# 抽賞訂單、收貨與出貨管理網站

第一版是純前端展示版，使用 HTML、SCSS、Vanilla JS 製作。

## 使用方式

直接開啟 `index.html` 即可使用。資料會存到同一台電腦、同一個瀏覽器的 `localStorage`，重新整理或關閉網頁後仍會保留。

## 第一版包含

- 訂單新增、修改、部分取消、部分出貨
- 收貨登記與可用庫存重新計算
- 活動與品項分開管理，同名品項不會跨活動混算
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

## Supabase 雲端同步試用

目前已加入 Supabase 試用同步模式。這個版本先把整份資料存成 Supabase `app_state` 表中的一筆 JSON，方便快速測試跨裝置同步。

在 Supabase SQL Editor 執行：

```sql
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "trial read app state"
on public.app_state for select
to anon
using (true);

create policy "trial insert app state"
on public.app_state for insert
to anon
with check (true);

create policy "trial update app state"
on public.app_state for update
to anon
using (true)
with check (true);
```

然後到網站的「雲端同步」分頁輸入：

- Supabase URL
- Supabase anon key

注意：這是方便試用的公開讀寫設定。正式營運前應改成登入後才能讀寫自己的資料，並重新設計 RLS 權限。
