# Privacy Policy - Web AI Monitor

[English](#english) | [简体中文](#简体中文)

Effective date: 2026-10-05

## English

Web AI Monitor ("the extension") is a browser extension that shows you your own AI usage limits and their reset countdowns. This policy explains what it reads, why, where the data stays, and what it never does. The extension is open source; everything described here can be checked in the code at https://github.com/DarkFlameSword/Web-AI-Monitor.

### Consent comes first

When the extension is installed, it opens a data use notice. **It reads nothing from any website until you click "Agree and start"** there or in its popup. You can read the notice again and withdraw your consent at any time from the popup's settings ("Data & privacy"). Withdrawing stops all reading at once and deletes the usage data the extension saved. If the extension's data practices ever change, it asks you again before doing anything new.

### What the extension reads, and why

The extension only reads what it needs to show your usage limits:

| Data | Where from | Why |
| --- | --- | --- |
| Your usage: percentage used of each limit, reset times, your plan, credit balances and the amount of credits spent this month | claude.ai, using your existing sign-in session (and chatgpt.com, only if you turn ChatGPT on) | To draw the gauges, countdowns and credits |
| The `lastActiveOrg` cookie on claude.ai (an organization ID) | claude.ai | To show the usage of the organization you are currently in |
| A ChatGPT access token, from chatgpt.com's own session endpoint | chatgpt.com, only if you turn ChatGPT on | To request your Codex usage. It is held in memory for that one request only and is never stored or sent anywhere else |
| The addresses and durations of the page's own network requests (never their content) | claude.ai and chatgpt.com pages only | To notice when a reply has finished, so the gauges refresh right away |

Responses from these sites may also contain your account name or email address. The extension does not use them and discards them right away; they are never stored.

### What the extension never does

- It never reads your conversations, prompts, replies or any other page content.
- It never reads your browsing history. On other websites (only if you turn on "show the HUD on every site") it only displays its HUD; it reads nothing from those pages, including their addresses.
- It never changes, bypasses or resets any usage limit, and never sends prompts on your behalf.
- It never sends your data to the developer or to any third party. It has no servers of its own, no analytics, no advertising and no tracking. It does not sell or transfer data.

### Where data is stored

The latest usage snapshot (the numbers above, without any token or cookie) and your settings are stored only in your browser, in `chrome.storage.local`. They are deleted when you withdraw consent (usage data) or uninstall the extension (everything). The only network requests the extension makes go to claude.ai and chatgpt.com themselves, over HTTPS, the same way their own web pages do.

### Permissions

| Permission | Use |
| --- | --- |
| `https://claude.ai/*` | Read your usage on claude.ai; show the HUD there |
| `storage` | Keep settings and the latest usage snapshot on your device |
| `alarms` | Refresh on the interval you choose and when a limit resets |
| `cookies` | Read the `lastActiveOrg` cookie on claude.ai, nothing else |
| `scripting` | Add the HUD to pages, only after you allow it |
| `https://chatgpt.com/*` (optional) | Asked only when you turn ChatGPT on |
| `http://*/*`, `https://*/*` (optional) | Asked only when you turn on the HUD for every site; used only to display the HUD |
| `notifications` (optional) | Asked only when you turn on the "fully restored" notice |

### Chrome Web Store User Data Policy

The use of information received from the extension's permissions will adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies), including the Limited Use requirements. The data is used only to provide the extension's single purpose (showing you your own AI usage limits), is not transferred to anyone, is not used for advertising, and is not read by humans.

### Children

The extension is not directed to children and collects no information from anyone.

### Changes to this policy

Changes are published in this file, with a new effective date. If a change affects what the extension reads or keeps, the extension shows its data use notice again and waits for your consent.

### Contact

Questions or requests: open an issue at https://github.com/DarkFlameSword/Web-AI-Monitor/issues

Web AI Monitor is an unofficial tool, not affiliated with or endorsed by Anthropic or OpenAI. Claude is a trademark of Anthropic, PBC. ChatGPT is a trademark of OpenAI.

## 简体中文

Web AI Monitor（以下称「本扩展」）是一个浏览器扩展，用来显示你自己的 AI 用量限额和恢复倒计时。本政策说明它读取什么、为什么读取、数据存在哪里，以及它绝不会做的事。本扩展开源，下面描述的一切都可以在 https://github.com/DarkFlameSword/Web-AI-Monitor 的代码里核对。

### 先征得同意

安装后，本扩展会打开一页数据说明。**在你点击「同意并开始」（在该页或弹窗中）之前，它不会从任何网站读取任何数据。** 你可以随时在弹窗设置的「数据与隐私」里重新查看说明或撤回同意。撤回后立即停止读取，并删除已保存的用量数据。如果数据使用方式发生变化，本扩展会在做任何新的事情之前再次征求你的同意。

### 读取什么、为什么

本扩展只读取显示用量所需的数据：

| 数据 | 来源 | 用途 |
| --- | --- | --- |
| 你的用量：各项限额的已用比例、重置时间、订阅方案、额度余额和本月已用额度 | claude.ai，使用你已有的登录会话（开启 ChatGPT 后也包括 chatgpt.com） | 显示能量条、倒计时和宝物袋 |
| claude.ai 的 `lastActiveOrg` cookie（组织 ID） | claude.ai | 显示你当前所在组织的用量 |
| ChatGPT 访问令牌，来自 chatgpt.com 自身的会话接口 | chatgpt.com，仅在你开启 ChatGPT 后 | 用来请求你的 Codex 用量。只在内存中用于这一次请求，从不保存，也不发往其他任何地方 |
| 网页自身网络请求的地址和耗时（从不读取内容） | 仅 claude.ai 和 chatgpt.com 页面 | 判断回复何时结束，以便立即刷新 |

这些网站的响应里也可能包含你的账户名或邮箱。本扩展不使用它们并立即丢弃，从不保存。

### 绝不会做的事

- 不读取你的对话、提示词、回复或任何其他网页内容。
- 不读取浏览记录。在其他网站上（仅当你开启「所有网页都显示」时）只显示悬浮窗，不读取这些网页的任何内容，包括网址。
- 不修改、绕过或重置任何用量限额，也不会代你发送任何内容。
- 不把你的数据发给开发者或任何第三方。没有自己的服务器，没有统计、广告和追踪，不出售或转让数据。

### 数据存在哪里

最近一次的用量快照（上表中的数字，不含任何令牌或 cookie）和你的设置只保存在你的浏览器中（`chrome.storage.local`）。撤回同意时删除用量数据，卸载扩展时全部删除。本扩展的网络请求只发往 claude.ai 和 chatgpt.com 本身，经由 HTTPS，与它们自己的网页一样。

### 权限

| 权限 | 用途 |
| --- | --- |
| `https://claude.ai/*` | 读取你在 claude.ai 上的用量；在 claude.ai 上显示悬浮窗 |
| `storage` | 在本机保存设置和最近的用量快照 |
| `alarms` | 按你选择的间隔刷新，并在限额重置时刷新 |
| `cookies` | 只读取 claude.ai 的 `lastActiveOrg` cookie |
| `scripting` | 在你允许后，把悬浮窗加到网页上 |
| `https://chatgpt.com/*`（可选） | 只在你开启 ChatGPT 时申请 |
| `http://*/*`、`https://*/*`（可选） | 只在你开启「所有网页都显示」时申请，只用来显示悬浮窗 |
| `notifications`（可选） | 只在你开启「能量完全恢复时提醒」时申请 |

### Chrome 应用商店用户数据政策

本扩展对通过其权限获得的信息的使用，遵守 [Chrome 应用商店用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/policies)，包括其中的「有限使用」（Limited Use）要求。数据只用于本扩展的单一用途（向你显示你自己的 AI 用量限额），不转让给任何人，不用于广告，也不会被人工查看。

### 儿童

本扩展不面向儿童，也不收集任何人的信息。

### 政策变更

变更会发布在本文件中，并更新生效日期。如果变更涉及本扩展读取或保存的数据，本扩展会重新显示数据说明并等待你同意。

### 联系方式

如有问题或请求，请在 https://github.com/DarkFlameSword/Web-AI-Monitor/issues 提交 issue。

Web AI Monitor 是非官方工具，与 Anthropic、OpenAI 无关联，也未获得其认可。Claude 是 Anthropic, PBC 的商标；ChatGPT 是 OpenAI 的商标。
