# 上架 Chrome 应用商店

这份文档按 Chrome 应用商店（Chrome Web Store，CWS）开发者后台的顺序，列出上架 Web AI Monitor 要准备和填写的全部内容。能直接粘贴的文字都放在代码块里；后台面向全球审核员，**隐私相关的字段建议填英文**。

依据的官方文档（提交前请在浏览器里再核对一次，政策会更新）：

- 程序政策总览：https://developer.chrome.com/docs/webstore/program-policies/policies
- 2026 年政策更新（2026-08-01 起执行：所有数据收集都必须在扩展界面里披露并取得同意；禁止规避 AI 服务的安全措施或用量限制）：https://developer.chrome.com/blog/cws-policy-updates-2026
- 用户数据 FAQ：https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- 隐私标签页填写说明：https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- 商店图片要求：https://developer.chrome.com/docs/webstore/images
- 审核流程：https://developer.chrome.com/docs/webstore/review-process

## 1. 提交前检查清单

账号（一次性）：

- [ ] 用 Google 账号注册 CWS 开发者，支付一次性 **5 美元** 注册费：https://chrome.google.com/webstore/devconsole
- [ ] 该 Google 账号开启 **两步验证**（不开无法发布）。
- [ ] 填写发布者名称，验证联系邮箱。
- [ ] **交易者声明**（欧盟 DSA，所有开发者都要选）：免费、不盈利的个人项目一般选「非交易者」（non-trader）。

代码与包：

- [ ] 合并到 `main`：隐私政策链接指向 `main` 分支上的 `PRIVACY.md`，合并前这个链接是 404，审核会因此拒绝（Purple Lithium）。
- [ ] 版本号：`extension/manifest.json` 和 `package.json` 的 `version` 一致，且比商店里已发布的版本高。
- [ ] `npm test` 和 `npm run preview` 全部通过。
- [ ] `npm run package` 生成 `dist/web-ai-monitor-<版本>.zip`。脚本会先检查商店的硬性要求（manifest_version 3、版本号格式、没有 `key` / `update_url`、引用的文件都存在、各语言名称不超过 75 字、简介不超过 132 字、不含隐藏文件 / `_` 开头的目录 / `.pem` / source map），不通过就不打包。
- [ ] 用打包出的 zip 解压后「加载已解压的扩展程序」再试一遍：首次安装会打开数据说明页，同意前不读取任何数据。

商店素材（`npm run store:assets` 生成，见第 3 节）：

- [ ] 商店图标 `docs/store/images/store-icon.png`（128x128）
- [ ] 截图：每种语言 5 张，1280x800
- [ ] 小宣传图 `promo-small.png`（440x280，必填）
- [ ] 大宣传图 `promo-marquee.png`（1400x560，可选，想上首页推荐位才需要）

## 2. 打包

```sh
npm run package          # -> dist/web-ai-monitor-<version>.zip，manifest.json 在 zip 根目录
```

- 只打包 `extension/` 目录：没有测试、脚本、文档和 node_modules。代码保持原样、未压缩，审核员能直接读（政策允许压缩，但禁止混淆；原样提交审核最快）。
- 不含远程代码：所有脚本都在包内，内容脚本用 `import(chrome.runtime.getURL(...))` 加载包内模块，这是官方推荐写法。
- zip 是可复现的：同一份源码两次打包结果逐字节相同。

## 3. 商店素材

```sh
npm install                       # 第一次用前装一次：Playwright
npx playwright install chromium   # 第一次用前装一次：Playwright 用的 Chromium（约 150 MB）
npm run store:assets              # 重新生成 docs/store/images/ 下的全部图片
```

第一次运行还会用 `npm pack` 下载完整的 Fusion Pixel Font（放在 `.cache/`），所以需要联网。

截图里的弹窗和悬浮窗都是扩展本身在 Chromium 里渲染的真实界面（数据来自模拟的 claude.ai / chatgpt.com），说明文字用完整的 Fusion Pixel Font 排版。脚本会检查每张图里文字不超出说明框、各块互不重叠。

截图和宣传图都是 24 位 PNG、无透明通道（后台要求「JPEG or 24-bit PNG (no alpha)」）；商店图标按规范带透明边距。五张截图依次是：能量条、页内悬浮窗、Claude 和 ChatGPT 各自的卡片、悬浮窗跟随切换、设置。

后台「Graphic assets」一节分三块，按下表上传（路径都在 `docs/store/images/` 下）：

| 后台区块 / 字段 | 上传 | 说明 |
| --- | --- | --- |
| Store icon | `store-icon.png` | 128x128，图案 96x96 + 每边 16px 透明边距 |
| Global assets → Global screenshots（必填） | `en/screenshot-1..5.png` | 所有没有单独上传截图的语言都显示这一组，所以放英文 |
| Global assets → Small promo tile | `promo-small.png` | 440x280；宣传图不能按语言区分，所以只放名称和图标 |
| Global assets → Marquee promo tile | `promo-marquee.png` | 1400x560，可选 |
| Localized assets → Localized screenshots | 中文：`zh_CN/screenshot-1..5.png`；日文：`ja/screenshot-1..5.png` | **每种语言分别上传**，见下 |
| 两个 promo video | 留空 | 可选 |

**按语言上传（Localized assets）**：Localized assets 一次只显示一种语言，切换语言要用 Store listing 页面**顶部的语言下拉框**。官方说明：「Begin by selecting the language from the dropdown list at the top of the store listing details. Each locale corresponds to one of the `_locales/LOCALE_CODE` directories included in the extension.」（[Localize your listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#localize-your-listing)）

1. 顶部下拉框选「English」：填英文详细说明。Localized screenshots 可以留空，会用上面的 Global screenshots。
2. 切到「中文（中国）」：填中文详细说明，在 Localized screenshots 上传 `zh_CN/` 的 5 张。
3. 切到「日本語」：填日文详细说明，在 Localized screenshots 上传 `ja/` 的 5 张。

下拉框里的语言来自上传的 zip 里的 `_locales/`（en、zh_CN、ja）。如果只看到一种语言，说明上传的包不对，重新 `npm run package` 后上传 `dist/` 里的 zip。

## 4. 后台「商品详情」（Store listing）

- **名称、简介**：来自 `extension/_locales/<语言>/messages.json`（`extName`、`extDescription`），后台不能单独改。
- **类别**：`Tools`（或 `Workflow & Planning`）。
- **语言**：默认语言是英文（`default_locale: en`），后台的默认商品详情填英文版。浏览器语言是中文、日文的用户看到对应语言的名称、简介和界面；其他语言的用户看到英文。中文、日文的详细说明和截图用页面顶部的语言下拉框切换后分别填写（见第 3 节）。
- **Additional fields**：
  - Official URL：选 `None`。这一项要求先在 Google Search Console 验证你拥有该网站，GitHub 仓库地址没法验证，留空不影响审核。
  - Homepage URL：`https://github.com/DarkFlameSword/Web-AI-Monitor`
  - Support URL：`https://github.com/DarkFlameSword/Web-AI-Monitor/issues`
  - Mature content：关闭。
- **详细说明**：按语言粘贴下面的文字。不要堆砌关键词（同一个词不超过 5 次），不要写「解锁」「绕过」「破解限额」之类的词。

### 详细说明：简体中文

```text
Web AI Monitor 用像素风的异世界冒险者公会卡，显示你的 AI 用量还剩多少，以及每项限额的恢复倒计时。

支持 Claude（claude.ai），可选支持 ChatGPT（chatgpt.com）。只读：只显示你自己的限额，从不修改、绕过或重置任何限额。

功能
- 每项限额一条能量条：魔力 MP = 当前会话，体力 HP = 每周全部模型，奥义 SP = 每周 Fable。都显示剩余量和恢复倒计时。
- 页内悬浮窗：在 claude.ai 上直接显示，授权后可在任意网页显示；可拖动、收起，大小 100% - 200%；显示你在弹窗里选中的那家 AI。
- 宝物袋：一眼看到额度余额（云端会话额度、用量额度；ChatGPT 的 Codex 额度和限额重置次数）。
- 冒险者资质按订阅方案评定，可以填写订阅到期日。
- 可选：用过的能量完全恢复时发一条桌面通知。
- 简体中文、日本語、English。

隐私
- 安装后先显示数据说明，你同意之前不读取任何数据。
- 只用你已有的登录状态读取 claude.ai（开启后含 chatgpt.com）上的用量数据，从不读取对话或网页内容。
- 数据只保存在你的浏览器里；没有统计、广告，也没有自己的服务器。
- 可选功能（所有网页显示悬浮窗、ChatGPT、通知）只在你开启时才申请对应权限。

开源：https://github.com/DarkFlameSword/Web-AI-Monitor
隐私政策：https://github.com/DarkFlameSword/Web-AI-Monitor/blob/main/PRIVACY.md

非官方工具，与 Anthropic、OpenAI 无关联，也未获得其认可。Claude 是 Anthropic, PBC 的商标；ChatGPT 是 OpenAI 的商标。
```

### 详细说明：English

```text
Web AI Monitor shows how much of your AI usage limits you have left, with a live countdown to each reset, drawn as a pixel-art adventurer's guild card.

Works with Claude (claude.ai) and, optionally, ChatGPT (chatgpt.com). Read-only: it only displays your own limits and never changes, bypasses or resets them.

FEATURES
- One gauge per limit: MP = current session, HP = weekly (all models), SP = weekly Fable. Each shows what is left and a live countdown to its reset.
- An on-page HUD: on claude.ai out of the box, on any site if you allow it. Drag it, collapse it, resize it (100% - 200%). It shows the vendor you pick in the popup.
- Treasure pouch: your credit balances at a glance (cloud session credits and usage credits; Codex credits and limit resets for ChatGPT).
- An adventurer rank from your plan, and the date your subscription ends if you enter it.
- Optional: a desktop notice when a used gauge is full again.
- Simplified Chinese, Japanese and English.

PRIVACY
- At install it shows a data use notice and reads nothing until you agree.
- It reads only your usage data from claude.ai (and chatgpt.com if you turn it on), using your existing sign-in. It never reads your conversations or page content.
- Data stays in your browser. No analytics, no ads, no servers of our own.
- Optional features (HUD on every site, ChatGPT, notifications) ask for their permission only when you turn them on.

Open source: https://github.com/DarkFlameSword/Web-AI-Monitor
Privacy policy: https://github.com/DarkFlameSword/Web-AI-Monitor/blob/main/PRIVACY.md

Unofficial; not affiliated with or endorsed by Anthropic or OpenAI. Claude is a trademark of Anthropic, PBC. ChatGPT is a trademark of OpenAI.
```

### 詳細説明：日本語

```text
Web AI Monitor は、AI の使用制限があとどれだけ残っているかと、各制限がリセットされるまでのカウントダウンを、ピクセルアートの「冒険者ギルドカード」で表示します。

Claude（claude.ai）に対応し、ChatGPT（chatgpt.com）にも任意で対応します。読み取り専用：表示するのはあなた自身の制限だけで、制限を変更・回避・リセットすることはありません。

機能
- 制限ごとのゲージ：魔力 MP = 現在のセッション、体力 HP = 週間（全モデル）、奥義 SP = 週間 Fable。残量とリセットまでの時間をリアルタイム表示。
- ページ上の HUD：claude.ai ではそのまま表示、許可すればどのサイトでも表示。ドラッグ・折りたたみ・サイズ変更（100% - 200%）。ポップアップで選んだ AI を表示します。
- 宝物袋：クレジット残高をひと目で（クラウドセッション枠と利用クレジット、ChatGPT では Codex クレジットと制限リセット回数）。
- プランに応じた冒険者ランクと、入力したサブスクの終了日。
- 任意：使ったゲージが全回復したらデスクトップ通知。
- 簡体字中国語・日本語・英語。

プライバシー
- インストール時にデータの説明を表示し、同意するまで何も読み取りません。
- 既存のログイン状態を使って claude.ai（有効にした場合は chatgpt.com も）の使用量データだけを読み取ります。会話やページの内容は読み取りません。
- データはブラウザ内にのみ保存されます。解析・広告・独自サーバーはありません。
- オプション機能（すべてのサイトでの HUD、ChatGPT、通知）は、オンにするときに初めて権限を求めます。

オープンソース：https://github.com/DarkFlameSword/Web-AI-Monitor
プライバシーポリシー：https://github.com/DarkFlameSword/Web-AI-Monitor/blob/main/PRIVACY.md

非公式ツールです。Anthropic および OpenAI とは関係がなく、承認も受けていません。Claude は Anthropic, PBC の商標です。ChatGPT は OpenAI の商標です。
```

## 5. 后台「隐私权」（Privacy practices）

### 单一用途（Single purpose）

```text
Shows the signed-in user's own AI usage limits (Claude, and optionally ChatGPT) and the countdown to each reset, in the toolbar popup and an optional on-page HUD. Read-only: it never changes, bypasses or resets any limit.
```

### 权限理由（Permission justification）

后台按下面的顺序列出输入框，每个框的上限是 1,000 字符。所有主机权限（必需的 claude.ai，以及可选的 chatgpt.com 和所有网站）共用一个「Host permission justification」框。页面上「Due to the Host Permission, your extension may require an in-depth review」的黄色提示是正常的，有主机权限的扩展都会显示。

**storage justification**（187 字符）

```text
Keeps the user's settings and the latest usage snapshot (percent used, reset times, plan, credit balances) on the device, so the popup and the HUD can show them. Nothing is sent anywhere.
```

**alarms justification**（146 字符）

```text
Refreshes the usage on the interval the user picks (1-30 minutes) and right when a limit window resets, so the gauges and countdowns stay correct.
```

**cookies justification**（244 字符）

```text
Reads exactly one cookie, lastActiveOrg on claude.ai, so the usage request asks for the organization the user is currently in. No other cookie is read, and the value is only used in that request to claude.ai: never stored or sent anywhere else.
```

**scripting justification**（254 字符）

```text
Used only after the user turns on "show the HUD on every site" or switches on ChatGPT: registers the packaged HUD content script for those sites and adds it to tabs already open. No remote code. The script only displays the HUD and reads no page content.
```

**notifications justification**（188 字符）

```text
Optional permission, requested only when the user ticks "tell me when a gauge is full again" in settings: shows one desktop notice when a used limit resets. No other notifications, no ads.
```

**Host permission justification**（840 字符）

```text
https://claude.ai/* (required): reads the user's own usage from claude.ai with their existing session, and shows the usage HUD on claude.ai. On claude.ai pages it notes when a reply finishes (request URL and timing only, never content) to refresh right away.

https://chatgpt.com/* (optional): requested only when the user ticks ChatGPT in settings. Reads the user's own Codex usage. The session access token from chatgpt.com/api/auth/session is kept in memory for that one request and never stored or sent anywhere else.

http://*/* and https://*/* (optional): requested only when the user ticks "show the HUD on every site". Used solely to display the usage HUD on pages the user visits; the extension reads no page content, URLs or browsing history from these sites.

Read-only throughout: it never changes, bypasses or resets any limit.
```

### 远程代码（Remote code）

「Are you using remote code?」选 **No, I am not using remote code**。选 No 后下面的 Justification 框会消失。本扩展所有脚本都在包内；内容脚本用 `import(chrome.runtime.getURL(...))` 加载的也是包内文件，不算远程代码。

### 数据使用（Data usage）

「What user data do you plan to collect from users now or in the future?」这里的「collect」按官方[用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) 的「handle」理解：不只是发到服务器，读取网站接口的响应内容、读取网站的 cookie 也算，只存在本地也算（FAQ 第 2、14 条）。勾选结果会公开显示在商品页上，并且必须和 `PRIVACY.md`、扩展的实际行为一致，不一致会被拒绝，严重时整个开发者账号被封。

按后台的顺序逐项填写：

| 后台类别 | 勾选 | 本扩展的实际情况 |
| --- | --- | --- |
| Personally identifiable information（姓名、地址、邮箱、年龄、证件号） | **勾选** | 扩展不使用也不保存姓名或邮箱，但 claude.ai 的组织列表和 chatgpt.com 的会话接口响应里可能带有账户名、邮箱，扩展收到后立即丢弃。按 FAQ，读到响应内容就算经手，从严勾选 |
| Health information（健康数据） | 不勾 | 不涉及 |
| Financial and payment information（交易、信用卡、信用评级、财务报表、付款记录） | **勾选** | 读取额度余额（云端会话额度、Codex 额度）和本月已用的用量额度金额、月度上限，用来显示宝物袋 |
| Authentication information（密码、凭据、安全问题、PIN） | **勾选** | 用浏览器已有的登录会话请求用量；读取 claude.ai 的 `lastActiveOrg` cookie；开启 ChatGPT 后取得会话访问令牌，只在内存中用于那一次请求，不保存 |
| Personal communications（邮件、短信、聊天消息） | 不勾 | 从不读取对话、提示词或回复内容 |
| Location（地区、IP、GPS） | 不勾 | 不读取位置 |
| Web history（访问过的网页列表、标题、访问时间） | 不勾 | 不读取浏览记录；在其他网站上只显示悬浮窗，不读取网址 |
| User activity（网络监测、点击、鼠标位置、滚动、键盘记录） | **勾选** | 在 claude.ai / chatgpt.com 页面上观察网页自身请求的地址和耗时（不含内容），用来在回复结束时立即刷新，属于网络监测 |
| Website content（文字、图片、声音、视频、链接） | **勾选** | 读取 claude.ai / chatgpt.com 接口返回的用量数据（已用比例、重置时间、方案） |

即勾选 5 项：Personally identifiable information、Financial and payment information、Authentication information、User activity、Website content。

「I certify that the following disclosures are true」的三项全部勾选（后台要求必须全选）：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### 隐私政策网址（Privacy policy URL）

```text
https://github.com/DarkFlameSword/Web-AI-Monitor/blob/main/PRIVACY.md
```

`PRIVACY.md` 里的「Data categories / 数据类别」一节和上表的 5 项一一对应。以后改了上表，记得同步改隐私政策。

## 6. 后台「测试说明」（Test instructions）

审核员没有你的账号时，常以「功能无法使用」（Yellow Magnesium）拒绝。建议提供一个测试用的 claude.ai 账号（免费账号即可，付费方案能看到更多能量条），并粘贴：

```text
1. Sign in to https://claude.ai (test account above; a free account works, paid plans show more gauges).
2. Install the extension. A "Guild registration" tab opens with the data use notice. Click "Agree and start". Nothing is read before this.
3. Click the toolbar icon: the popup shows the MP / HP / SP gauges with live reset countdowns. Open claude.ai: the HUD appears in the bottom-right corner.
4. Optional, in Settings: tick "ChatGPT" to monitor ChatGPT (asks for chatgpt.com; needs a ChatGPT login with Codex access). Tick "On every site" to show the HUD everywhere (asks for all-sites access; it only displays the HUD).
5. Signed out, the popup says "Not registered: sign in to claude.ai".

The extension is read-only. It never changes, bypasses or resets usage limits, never sends prompts, and never reads conversation or page content. Settings > "Data & privacy" shows the notice again and lets the user withdraw consent, which deletes the stored usage data.
```

## 7. 后台「分发」（Distribution）

- 付费：免费（Free），无应用内购买。
- 可见性：公开（Public）。想先小范围试用可以选「不公开」（Unlisted），审核标准相同。
- 地区：所有地区。

## 8. 审核风险与对应措施

| 风险 | 本扩展的处理 |
| --- | --- |
| 2026 年起：所有数据收集都要在扩展界面里披露并取得明确同意，商店描述里写不算 | 安装时打开数据说明页，点「同意并开始」之前不发任何请求、不显示悬浮窗、不观察页面请求；弹窗在同意前只显示简短说明和同意按钮；设置里可以随时查看说明、撤回同意（撤回即删除用量数据）。数据使用方式改变时，把 `extension/core/consent.js` 的 `DATA_PRACTICES_VERSION` 加一，所有用户会重新看到说明并重新同意 |
| 2026 年起：禁止规避 AI 服务的安全措施或用量限制 | 扩展只读，只显示用户自己的限额；描述、单一用途、测试说明都写明「从不修改、绕过或重置限额」，避免「解锁」「绕过」等字眼 |
| 与窃取 AI 对话的恶意扩展技术相似（在 claude.ai / chatgpt.com 上运行内容脚本） | 不改写页面的 `fetch`，只用 `PerformanceObserver` 看请求地址和耗时；代理请求限定在允许列表里的只读 GET 路径；ChatGPT 会话接口经标签页返回时只交回令牌、账户 id 和方案，其余字段不离开页面。权限理由和测试说明都写明 |
| 宽泛的主机权限、cookies + 主机权限会延长审核 | 所有网站权限是可选的，默认关闭，只在用户勾选时申请；`cookies` 只读一个 cookie，理由写明 |
| 商标 | 名称和图标不含 Claude / ChatGPT 字样或标志；描述里用「支持 Claude」的写法，并附非官方声明和商标归属 |
| 扩展可被网站识别（指纹；不违反政策，只是隐私加固项） | 悬浮窗模块必须声明为 `web_accessible_resources` 才能被内容脚本 `import()`。实测开启 Chrome 的 `use_dynamic_url` 后内容脚本无法再加载这些模块、悬浮窗失效，所以没有开启；这些文件里只有界面代码，没有任何数据 |
| 第三方服务条款 | 只读取用户自己的用量，请求频率由用户控制（1 - 30 分钟），未登录时自动降到 30 分钟一次 |

## 9. 发布之后

- 更新：改版本号，`npm run package`，在后台上传新 zip。商店会自动推送给用户。
- 数据使用方式有任何变化（多读了什么、存了什么、发往哪里）：同时更新 `PRIVACY.md`、本文第 5 节、后台的数据使用勾选，并把 `DATA_PRACTICES_VERSION` 加一。
- 新增界面文字后运行 `npm run build:font` 重新生成字体子集。
