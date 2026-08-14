//go:build !linux

package main

// Windows(WebView2)/macOS(WKWebView) には WebKitGTK 固有の調整は不要。
func configureWebviewEnv() {}
