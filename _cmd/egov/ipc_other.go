//go:build !windows

package main

func tryIPCServer(onFile func(string)) bool { return false }
func sendIPC(path string) error             { return nil }
