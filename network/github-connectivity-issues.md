# GitHub 网络连接问题分析与解决方案

> **主题**: GitHub 网络连接问题分析与解决方案  
> **创建时间**: 2026-03-04  
> **更新时间**: 2026-03-04  
> **标签**: #network #github #gfw #connectivity #proxy #ssh #cloudflare

---

## 1. 根本原因分析

### 1.1 GFW 动态策略

GitHub 网络不稳定的根本原因在于**防火长城 (GFW) 的动态策略**，主要包括以下技术手段：

| 技术手段 | 描述 | 影响 |
|---------|------|------|
| **DNS 污染** | 篡改 DNS 解析结果，返回错误或不可达 IP | 域名解析失败或指向错误服务器 |
| **SNI 阻断** | 检测 TLS 握手时的 Server Name Indication 字段 | HTTPS 连接被中断 |
| **TCP RST** | 发送伪造的 TCP Reset 包终止连接 | 连接意外中断 |
| **QoS 限速** | 对特定流量进行带宽限制 | 访问速度极慢或超时 |

### 1.2 直接诱因

除 GFW 策略外，以下因素加剧了连接问题：

| 诱因 | 说明 |
|-----|------|
| **GitHub IP 池动态轮换** | GitHub 使用 CDN 和动态 IP 分配，部分 IP 段被封锁 |
| **运营商劫持与缓存** | 部分运营商对 HTTPS 流量进行中间人检测或缓存干扰 |
| **GitHub 风控限流** | GitHub 对异常流量（如大量 403/429 请求）进行限流处理 |

---

## 2. 解决方案对比

### 2.1 方案概览

| 方案 | 原理 | 适用场景 | 优缺点 |
|-----|------|---------|--------|
| **Cloudflare Workers 代理** | 边缘节点反向代理，转发 GitHub 请求 | 团队/CI 环境 | ✅ 配置简单、全球加速<br>❌ workers.dev 子域名已被污染，需自定义域名 |
| **SSH 替代 HTTPS** | 使用 SSH 协议直连 22/443 端口 | 个人开发 | ✅ 443 端口存活率高、协议特征不同<br>❌ 需要配置 SSH 密钥 |

### 2.2 方案详解

#### 方案 A: Cloudflare Workers 代理

**关键洞察**: `workers.dev` 子域名已被 GFW 污染，**必须使用自定义域名**才能正常使用。

**工作原理**:
- 利用 Cloudflare 全球边缘节点作为反向代理
- 将 GitHub 请求转发至 Workers，再由 Workers 转发到 GitHub
- 流量特征变为 Cloudflare 边缘节点 ↔ 用户，规避直接封锁

**配置步骤**:
1. 创建 Cloudflare Workers 脚本转发 GitHub 请求
2. **绑定自定义域名**（⚠️ 不能使用 workers.dev 子域名）
3. 配置 Git 使用代理地址

**适用场景**: 团队协作、CI/CD 流水线、需要稳定代理服务的场景

#### 方案 B: SSH 替代 HTTPS

**关键洞察**: 端口存活率排序：**SSH 443 端口 > SSH 22 端口 > HTTPS**，在多数被墙场景下存活率更高。

**原理分析**:
- SSH 与 HTTPS 协议特征不同，GFW 识别策略存在差异
- 443 端口为 HTTPS 标准端口，流量混杂度高，更难精准识别
- 22 端口虽为 SSH 标准端口，但特征明显，易被针对性封锁

**配置步骤**:

1. **生成 SSH 密钥对**（如尚未配置）:
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **将公钥添加到 GitHub 账户**:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   # 复制内容到 GitHub Settings -> SSH and GPG keys
   ```

3. **修改 Git 远程 URL 为 SSH 格式**:
   ```bash
   git remote set-url origin git@github.com:username/repo.git
   ```

4. **配置 SSH 使用 443 端口**（推荐，存活率最高）:
   ```bash
   # 编辑 ~/.ssh/config
   Host github.com
     Hostname ssh.github.com
     Port 443
     User git
     IdentityFile ~/.ssh/id_ed25519
   ```

**适用场景**: 个人日常开发、对延迟敏感的场景

---

## 3. 推荐策略

### 决策矩阵

| 场景 | 推荐方案 | 理由 |
|-----|---------|------|
| **个人开发** | SSH 443 端口 | 配置简单、延迟低、存活率高 |
| **团队协作** | Cloudflare Workers 代理 | 统一配置、无需每台机器配 SSH key |
| **CI/CD 流水线** | Cloudflare Workers 代理 | 避免 SSH 密钥管理复杂性 |
| **临时应急** | SSH 443 端口 | 最快恢复访问 |

### 实施建议

1. **个人用户**: 优先配置 SSH 443 端口，作为日常主力方案
2. **团队/组织**: 搭建 Cloudflare Workers 代理服务，提供统一访问入口
3. **混合策略**: 同时配置两种方案，根据网络状况灵活切换

---

## 4. 故障排查速查表

| 现象 | 可能原因 | 解决方案 |
|-----|---------|---------|
| `Could not resolve host` | DNS 污染 | 更换 DNS 或修改 hosts |
| `Connection reset by peer` | TCP RST 阻断 | 切换 SSH 443 端口 |
| `SSL certificate problem` | SNI 阻断/中间人攻击 | 使用 SSH 替代 HTTPS |
| `403 Forbidden` / `429 Too Many Requests` | GitHub 风控限流 | 减少请求频率，使用代理分散 IP |
| 速度极慢 | QoS 限速 | 使用 Cloudflare Workers 代理 |

---

## 5. 参考资源

- [GitHub 官方 SSH 文档](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- [Using SSH over the HTTPS port](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)

---

## 6. 更新日志

| 日期 | 更新内容 |
|-----|---------|
| 2026-03-04 | 初始版本，整理根本原因与解决方案 |
| 2026-03-04 | 新增端口存活率分析、决策矩阵、故障排查速查表 |

---

*本文档基于社区讨论整理，持续更新中。如有补充或更正，欢迎提交 PR。*
