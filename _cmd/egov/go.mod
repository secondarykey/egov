module github.com/secondarykey/egov/cmd/egov

go 1.27.0

require (
	egov v0.0.0-00010101000000-000000000000
	github.com/Microsoft/go-winio v0.6.2
	github.com/wailsapp/wails/v3 v3.0.0-beta.16
)

require (
	github.com/Eyevinn/mp4ff v0.55.0 // indirect
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/jchv/go-winloader v0.0.0-20250406163304-c1995be93bd1 // indirect
	github.com/kettek/apng v0.0.0-20250827064933-2bb5f5fcf253 // indirect
	github.com/mattn/go-colorable v0.1.15 // indirect
	github.com/mattn/go-isatty v0.0.22 // indirect
	golang.org/x/image v0.41.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
)

replace egov => ../../

replace golang.org/x/image => github.com/secondarykey/image v0.0.0-20260916190550-38b3c5a87075
