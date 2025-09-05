# 📚 课表毒舌评价师

> 让AI来犀利点评你的大学课表，看看这学期你能不能活下去！

[![Vue3](https://img.shields.io/badge/Vue-3.x-4FC08D?style=for-the-badge&logo=vue.js)](https://vuejs.org/)
[![Chart.js](https://img.shields.io/badge/Chart.js-3.9-FF6384?style=for-the-badge&logo=chart.js)](https://www.chartjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

## ✨ 项目简介

**课表毒舌评价师** 是一个专为大学生设计的课表分析和评价网站。通过AI智能分析，为你的课表提供犀利幽默但具有建设性的评价，帮助你更好地了解这学期的"生存"难度。

### 🎯 核心特性

- 🤖 **AI毒舌评价**：从8个维度深度分析你的课表，语言犀利幽默
- 📊 **可视化统计**：直观的图表展示课时分布和学习负担
- 😊 **幸福度指标**：量化分析早八、课业负担、社交影响等关键指标
- 📁 **多格式支持**：支持PDF和WakeUp课程表备份文件上传
- 🎓 **大学特化**：深度理解单双周、特定周次等大学课表复杂性
- 📱 **响应式设计**：完美适配桌面端和移动端

## 🚀 快速开始

### 环境要求

- 现代浏览器 (Chrome 90+, Firefox 88+, Safari 14+)
- 支持ES6+的JavaScript环境

### 安装运行

1. **克隆项目**
   ```bash
   git clone https://github.com/hexwarrior6/schedule-roast-master.git
   cd schedule-roast-master
   ```

2. **直接打开**
   ```bash
   # 使用任意HTTP服务器运行
   python -m http.server 8000
   # 或
   npx serve .
   # 或直接在浏览器中打开 index.html
   ```

3. **访问应用**
   ```
   http://localhost:8000
   ```

## 🔧 技术架构

### 前端技术栈
- **Vue 3** - 响应式框架，使用Composition API
- **Chart.js** - 数据可视化图表库
- **PDF.js** - PDF文件解析
- **原生CSS** - 现代化UI设计，支持毛玻璃效果和渐变

### 核心功能模块
```
src/
├── components/           # Vue组件
│   ├── FileUpload.vue   # 文件上传组件
│   ├── AIReview.vue     # AI评价展示
│   ├── Statistics.vue   # 统计图表
│   └── Metrics.vue      # 幸福度指标
├── utils/               # 工具函数
│   ├── fileParser.js    # 文件解析
│   ├── scheduleAnalyzer.js # 课表分析
│   └── aiPrompts.js     # AI提示词
└── styles/              # 样式文件
    └── main.css         # 主样式
```

## 📋 功能详述

### 🤖 AI评价系统

AI从以下8个维度对课表进行评价：

1. **📅 周次地狱指数** - 分析单双周、特定周次安排的复杂程度
2. **🌅 早八地狱指数** - 评估早八课程对生活作息的影响
3. **⏰ 课程分布合理性** - 分析时间安排的人性化程度
4. **🏃 连续上课耐力测试** - 评估连续上课的身体挑战
5. **🧠 记忆力挑战赛** - 分析复杂课表对记忆力的要求
6. **📊 课业负担波动性** - 评估不同时期学习压力变化
7. **🎉 社交生活影响** - 分析对课外活动和社交的影响
8. **🎯 总体幸福度预测** - 综合评估并给出生存建议

### 📊 数据可视化

- **周课时分布图**：展示前7周的课时变化趋势
- **课程时间热力图**：直观显示一周内课程密度分布
- **负担波动曲线**：展示整学期课业负担变化

### 😊 幸福度指标

- **早八节数**：统计痛苦的早八课程数量
- **最长连续空闲时间**：计算可用于休息的最长时间
- **周次复杂度**：量化单双周等复杂安排的混乱程度
- **记忆挑战指数**：评估记住课表的难度

## 📁 支持的文件格式

### WakeUp课程表文件 (推荐)
- 格式：`.json` / `.txt`
- 包含完整的课程信息、周次安排、教室位置等
- 支持单双周、特定周次等复杂安排

### PDF课表文件
- 格式：`.pdf`
- 自动识别表格结构
- 提取课程名称、时间、地点等信息

## 🎨 界面预览

### 主界面
- 现代化渐变背景
- 毛玻璃效果卡片设计
- 支持拖拽上传

### 评价结果
- 评分卡片突出显示
- 分区块展示不同维度评价
- 响应式布局适配移动端

### 统计图表
- 彩色柱状图展示课时分布
- 交互式图表支持悬停查看详情
- 自适应图表大小

## 🔮 AI评价示例

```
📅 周次地狱指数
看到你这单双周交替的安排，我仿佛看到了你每周日晚上查课表的绝望表情。
建议在手机里设置"本周课表提醒"，否则你可能会在空教室里独自凌乱，思考人生的意义。

🌅 早八地狱指数  
不规律的早八比固定早八更要命！恭喜你解锁3个早八成就，建议准备好闹钟备用电池和强效咖啡。
你的生物钟即将经历一场史诗级的改造。

🧠 记忆力挑战赛
这种复杂的周次安排简直是对人类记忆力的终极考验。
建议把课表纹在胳膊上，或者植入大脑芯片，这样就不会忘记了。
```

## 🚧 开发计划

### 近期目标
- [ ] 集成Claude API实现真实AI评价
- [ ] 完善PDF解析算法
- [ ] 添加课表导出功能
- [ ] 支持更多课表格式

### 长期规划
- [ ] 用户系统和课表保存
- [ ] 课表对比和历史记录
- [ ] 社交分享功能
- [ ] 课程推荐系统
- [ ] 移动端原生应用

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献方式
1. **Fork** 本项目
2. **创建** 特性分支 (`git checkout -b feature/amazing-feature`)
3. **提交** 更改 (`git commit -m 'Add amazing feature'`)
4. **推送** 到分支 (`git push origin feature/amazing-feature`)
5. **创建** Pull Request

### 开发规范
- 使用ESLint进行代码检查
- 提交信息遵循Conventional Commits规范
- 添加必要的测试用例
- 更新相关文档

## 📄 许可证

本项目采用 [MIT](LICENSE) 许可证。你可以自由使用、修改和分发本项目。

## 👥 贡献者

<a href="https://github.com/hexwarrior6/schedule-roast-master/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hexwarrior6/schedule-roast-master" />
</a>

## 📞 联系我们

- 项目主页: https://github.com/hexwarrior6/schedule-roast-master
- 问题反馈: [Issues](https://github.com/hexwarrior6/schedule-roast-master/issues)
- 功能建议: [Discussions](https://github.com/hexwarrior6/schedule-roast-master/discussions)

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=hexwarrior6/schedule-roast-master&type=Date)](https://star-history.com/#hexwarrior6/schedule-roast-master&Date)

---

<p align="center">
  <b>让课表评价变得有趣 🎉</b><br>
  如果这个项目对你有帮助，请给我们一个 ⭐ Star！
</p>