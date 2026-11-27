# 课表毒舌评价师 · Schedule Roast Master

上传一张大学课表截图，让多模态 AI 识别课程、给出八维锐评与学期生存报告。

## 功能

- 单张图片上传、拖拽、预览与大图压缩（JPG / PNG / WebP）
- 高精度图片识别与文本评价分两阶段调用；逐日课程数量与 Zod 校验；整图与四个重叠局部放大图联合识别；课程目录或不明确的课表仍给假设性评价
- AI 幸福度趣味评分、八维毒舌点评、称号、标签、生存建议
- 本地确定性计算可见课程块、9 点前课程块与课程分布；未知数据不猜测
- 查看识别课程表，导出 PNG 分享海报；不调用 API 的示例报告
- 响应式、移动端优先，无账号、数据库或持久化文件存储

## 本地运行

Node.js 22 LTS 推荐。安装 pnpm 10 后运行：

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

访问 http://localhost:3000。即使没有 API 配置，也可以体验示例报告。

在 .env.local 中配置：

```dotenv
AI_BASE_URL=https://api.example.com/v1
AI_API_KEY=your-key
AI_MODEL=your-vision-model
ANALYSIS_ACCESS_CODE=
```

模型必须支持 OpenAI 兼容 Chat Completions、image_url data URL 与文本输出；部分供应商对 max_tokens 或输出 JSON 格式支持不同，需实测。密钥只在服务端读取。ANALYSIS_ACCESS_CODE 是可选的共享测试访问码，不是完整用户系统。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

首次安装会生成 pnpm-lock.yaml，请将锁文件提交到仓库以固定依赖。当前迁移未包含锁文件。

## Vercel 部署

导入 GitHub 仓库，选择 Next.js 框架，设置上述环境变量，再部署。API Route 使用 Node.js runtime，单张图片的上传上限为 3 MiB。大图会先在浏览器压缩；服务器再检查大小与文件签名。每次模型请求设置 45 秒超时；API Route 最大时长 120 秒。所有可识别课表通常两次调用。局部放大提高可读性，但不能恢复原图缺失细节，且会增加图片 token 消耗。

**公开上线前**：配置 Vercel Firewall 或其他网关的跨实例限流、供应商额度和消费上限。代码内的单实例限流不是生产级分布式限流。测试部署建议设置 ANALYSIS_ACCESS_CODE。实际部署平台的执行时长及模型兼容性需验证。

图片会发送给配置的 AI 服务商，本站代码不持久化保存图片或报告；服务商的数据处理与保留政策另计。用户应先遮挡姓名、学号等敏感信息。模型识别可能遗漏课程或误读周次，统计仅针对可见课程块，幸福度分数属于娱乐性质估计。

## 技术栈

Next.js App Router · TypeScript · React · Tailwind CSS · Lucide · OpenAI SDK · Zod · html-to-image · Vitest

## 目录

- app/：页面、全局样式、POST /api/analyze
- components/：上传和报告界面
- lib/：提示词、数据结构、统计、图片处理及测试

历史 Vue/Vite 版本与原始 Prompt 保留在 Git 历史中。本次仅保留图片导入，不实现 WakeUp、PDF、ICS、账号或课表管理。
