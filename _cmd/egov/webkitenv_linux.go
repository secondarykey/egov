//go:build linux

package main

import (
	"log/slog"
	"os"
)

// configureWebviewEnv は WebKitGTK 向けの環境変数を設定する。
//
// WebKitGTK 2.40 以降はデコード済み動画フレームを DMA-BUF（YUV マルチプレーン＋
// DRM format modifier）でゼロコピー転送するが、ドライバがその形式に対応して
// いないとタイル化されたバッファをリニアな RGB として読んでしまい、
// 映像が砂嵐状に化ける。Intel Haswell 世代の Mesa が該当し、起動時に
// 「FINISHME: support YUV colorspace with DRM format modifiers」を出力する。
//
// egov は動画フレームを Three.js の VideoTexture 経由で WebGL に転送するため
// この経路に強く依存しており、化けると映像がまったく判別できなくなる。
// ゼロコピーが効かなくなる分の転送コストより表示の正しさを優先して既定で無効化する。
//
// 既に環境変数が設定されている場合は利用者の指定を尊重して触らない。
// ドライバが DMA-BUF を正しく扱える環境では
// `WEBKIT_DISABLE_DMABUF_RENDERER=0` で明示的に上書きできる。
//
// 環境変数は WebKit の Web プロセスが fork される前、すなわち
// application.New() より前に設定する必要がある。
func configureWebviewEnv() {
	const key = "WEBKIT_DISABLE_DMABUF_RENDERER"
	if v, ok := os.LookupEnv(key); ok {
		slog.Debug("webkit dmabuf renderer setting kept", "key", key, "value", v)
		return
	}
	if err := os.Setenv(key, "1"); err != nil {
		slog.Warn("failed to set webkit env", "key", key, "err", err)
		return
	}
	slog.Debug("webkit dmabuf renderer disabled (set 0 to override)", "key", key)
}
