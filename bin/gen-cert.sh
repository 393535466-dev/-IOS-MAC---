#!/bin/bash
# 龙虾脑 · 生成 / 重签 HTTPS 自签名证书
#
# 关键点：SAN 里包含「固定的 .local 域名」（macOS Bonjour），
# 局域网 IP 由路由器 DHCP 分配、随时会变，但 .local 域名不变，
# 因此用 https://<主机名>.local:8788/ 访问时证书永远匹配。
#
# 用法：
#   ./bin/gen-cert.sh                      # 自动取当前 IP，并兼容旧 IP 192.168.8.45
#   ./bin/gen-cert.sh 192.168.8.45,192.168.1.9   # 追加更多要兼容的 IP
#
# 生成后必须重启服务（双击 start.command），HTTPS 才会加载新证书。
set -e
cd "$(dirname "$0")/.."
CERT_DIR="cert"
mkdir -p "$CERT_DIR"

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$LAN_IP" ] && LAN_IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
LOCAL_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"

SAN="DNS:${LOCAL_NAME}.local,DNS:localhost,IP:127.0.0.1"
[ -n "$LAN_IP" ] && SAN="${SAN},IP:${LAN_IP}"

# 旧 IP / 其他常用地址可追加，避免主屏幕里的旧书签立刻失效
EXTRA="${1:-192.168.8.45}"
if [ -n "$EXTRA" ]; then
  IFS=',' read -ra ARR <<< "$EXTRA"
  for ip in "${ARR[@]}"; do
    ip="$(echo "$ip" | xargs)"
    [ -z "$ip" ] && continue
    case ",$SAN," in
      *",IP:${ip},"*) ;;
      *) SAN="${SAN},IP:${ip}" ;;
    esac
  done
fi

CONF="$(mktemp /tmp/lb-cert-XXXXXX.conf)"
trap 'rm -f "$CONF"' EXIT
cat > "$CONF" <<EOF
[req]
prompt = no
distinguished_name = dn
x509_extensions = v3_ext

[dn]
CN = LobsterBrain

[v3_ext]
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage = serverAuth
subjectAltName = ${SAN}
EOF

openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
  -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" -config "$CONF" 2>/dev/null
cp "$CERT_DIR/cert.pem" "$CERT_DIR/lobsterbrain.crt"

echo "证书已生成（有效期 365 天，含 CA:TRUE / serverAuth 扩展）"
echo "  SAN: ${SAN}"
echo "  推荐固定入口: https://${LOCAL_NAME}.local:8788/"
echo "  手机下载根证书: http://${LAN_IP}:8787/cert.crt"
echo "  请双击 start.command 重载服务后生效。"
