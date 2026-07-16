//go:build windows

package main

import (
	"io"
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

const ipcPipeName = `\\.\pipe\egov-player`

// tryIPCServer tries to become the named-pipe server.
// Returns true (and starts listening) when this is the first instance.
// Returns false when a server already exists.
func tryIPCServer(onFile func(string)) bool {
	ln, err := winio.ListenPipe(ipcPipeName, nil)
	if err != nil {
		return false
	}
	go func() {
		defer ln.Close()
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go ipcReadConn(conn, onFile)
		}
	}()
	return true
}

// ipcMaxPayload はIPCで受け付ける最大バイト数。ファイルパス1件のみを想定した
// 通信のため、不正なクライアントからの巨大データ送信によるメモリ消費を防ぐ。
// Windows の拡張パス上限（約32K文字）を余裕を持って超える値。
const ipcMaxPayload = 64 * 1024

func ipcReadConn(conn net.Conn, onFile func(string)) {
	defer conn.Close()
	data, err := io.ReadAll(io.LimitReader(conn, ipcMaxPayload))
	if err == nil && len(data) > 0 {
		onFile(string(data))
	}
}

// sendIPC sends a file path to the already-running instance.
func sendIPC(path string) error {
	timeout := 2 * time.Second
	conn, err := winio.DialPipe(ipcPipeName, &timeout)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Write([]byte(path))
	return err
}
