# Token Budget — AI 成本计算器

一个无需 API Key、完全在浏览器本地运行的 Chrome 小插件。输入单次 Token、月调用量和缓存命中率，即可比较主流 AI 模型的单次与月度成本。

## 功能

- 客服问答、RAG 助手、Agent 工作流三种场景模板
- 同时比较 OpenAI、Anthropic、Google 的 8 个模型
- 自动拆分普通输入、缓存输入、输出成本
- 显示美元与人民币参考值，并判断是否超出月度预算
- 支持自定义模型和自定义价格
- 一键导出 CSV 估算报告
- 自动记住上次输入，所有数据仅保存在本地浏览器

## 安装

1. 下载并解压插件文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions/`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择 `02-ai-cost-calculator` 文件夹。

## 价格口径

价格快照日期：**2026-09-05**。所有价格均为标准文本 Token 价格，单位是 USD / 100 万 Token。

- [OpenAI 模型价格](https://developers.openai.com/api/docs/models/compare)
- [Anthropic API 价格](https://platform.claude.com/docs/en/about-claude/pricing)
- [Google Gemini API 价格](https://ai.google.dev/gemini-api/docs/pricing)

估算不包含缓存存储、工具调用、搜索、图片/音频、Batch、Priority、税费或第三方平台加价。实际账单请以各服务商为准。
