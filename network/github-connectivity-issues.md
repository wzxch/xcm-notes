# GitHub 网络连接问题分析与解决方案

> **主题**: GitHub 网络连接问题分析与解决方案  
> **创建时间**: 2026-03-04  
> **标签**: #network #github #gfw #connectivity #proxy

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

- **GitHub IP 池动态轮换**: GitHub 使用 CDN 和动态 IP 分配，部分 IP 段被封锁
- **运营商劫持与缓存**: 部分运营商对 HTTPS 流量进行中间人检测或缓存干扰
- **GitHub 风控限流**: GitHub 对异常流量（如大量 403/429 请求）进行限流处理

---

## 2. 解决方案对比

### 2.1 方案概览

| 方案 | 原理 | 优点 | 缺点 |
|-----|------|------|------|
| **Cloudflare Workers 代理** | 通过 Workers 转发 GitHub 请求 | 配置简单、全球加速 | workers.dev 子域名已被污染 |
| **SSH 替代 HTTPS** | 使用 SSH 协议进行 Git 操作 | 443 端口存活率高、稳定 | 需要配置 SSH 密钥 |

### 2.2 方案详解

#### 方案 A: Cloudflare Workers 代理

**关键洞察**: `workers.dev` 子域名已被 GFW 污染，**必须使用自定义域名**才能正常使用。

**配置步骤**:
1. 创建 Cloudflare Workers 脚本转发 GitHub 请求
2. 绑定自定义域名（不能是 workers.dev）
3. 配置 Git 使用代理地址

#### 方案 B: SSH 替代 HTTPS

**关键洞察**: SSH **443 端口**存活率最高，建议优先使用。

**配置步骤**:
1. 生成 SSH 密钥对（如尚未配置）
2. 将公钥添加到 GitHub 账户
3. 修改 Git 远程 URL 为 SSH 格式：
   ```bash
   git remote set-url origin git@github.com:username/repo.git
   ```
4. 配置 SSH 使用 443 端口（如 22 端口被封锁）：
   ```
   # ~/.ssh/config
   Host github.com
     Hostname ssh.github.com
     Port 443
   ```

---

## 3. 推荐策略

### 短期应急
- 使用 SSH 443 端口进行 Git 操作
- 配置 hosts 文件指向可用 IP

### 长期稳定
- 搭建 Cloudflare Workers 代理（使用自定义域名）
- 考虑使用商业 VPN 或专线服务

---

## 4. 参考资源

- [GitHub 官方 SSH 文档](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)

---

*本文档基于 2026-03-04 的讨论整理，如有更新请同步维护。*
