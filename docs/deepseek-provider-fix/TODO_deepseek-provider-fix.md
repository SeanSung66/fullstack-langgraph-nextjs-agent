# TODO: DeepSeek Provider 修复

## 待办事项

### 1. 配置 DeepSeek API Key
在 `.env` 文件中添加：
```
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

### 2. 功能验证
1. 启动开发服务器：`pnpm dev`
2. 在 UI 中选择 Provider: DeepSeek
3. 确认 Model 自动切换为 `deepseek-chat`
4. 发送测试消息
5. 确认收到 DeepSeek 的响应

### 3. 添加 DeepSeek Logo (可选)
如需在 UI 显示 DeepSeek logo，添加文件：
```
public/deepseek.svg
```
