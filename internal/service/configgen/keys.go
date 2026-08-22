package configgen

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

// GenUUID 生成 VLESS 用户 UUID
func GenUUID() string {
	return uuid.NewString()
}

// GenSSKey 按 2022 系加密方式生成定长 base64 密钥
func GenSSKey(method string) (string, error) {
	length, ok := ss2022KeyLengths[method]
	if !ok {
		return "", fmt.Errorf("加密方式 %q 不是 2022 系，无法自动生成密钥", method)
	}
	raw := make([]byte, length)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// GenRealityKeypair 生成 Reality 所需的 X25519 密钥对（base64 无填充），
// private_key 填服务端配置，public_key 提供给客户端。
func GenRealityKeypair() (privateKey, publicKey string, err error) {
	priv, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	return base64.RawURLEncoding.EncodeToString(priv.Bytes()),
		base64.RawURLEncoding.EncodeToString(priv.PublicKey().Bytes()),
		nil
}

// GenShortID 生成 Reality short_id（8 位十六进制，规范允许 0-8 位）
func GenShortID() string {
	raw := make([]byte, 4)
	_, _ = rand.Read(raw)
	return hex.EncodeToString(raw)
}

// RealityPublicKey 从 Reality 私钥推导公钥（客户端分享链接需要公钥，
// 浏览器端无法做 X25519 推导，由面板代劳）
func RealityPublicKey(privateKey string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(privateKey)
	if err != nil {
		raw, err = base64.StdEncoding.DecodeString(privateKey)
		if err != nil {
			return "", fmt.Errorf("私钥不是合法的 base64 字符串")
		}
	}
	priv, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return "", fmt.Errorf("私钥无效: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(priv.PublicKey().Bytes()), nil
}
