package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()
	ollamaProxy := &OllamaProxy{}

	AppMenu := menu.NewMenu()
	FileMenu := AppMenu.AddSubmenu("Actions")
	FileMenu.AddText("Quit", keys.CmdOrCtrl("q"), func(_ *menu.CallbackData) {
		runtime.Quit(app.ctx)
	})
	FileMenu.AddSeparator()
	FileMenu.AddText("Cluster selection", keys.CmdOrCtrl("s"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "backToClusterSelection", nil)
	})
	FileMenu.AddText("Close current tab", keys.CmdOrCtrl("w"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "closeTab", nil)
	})	

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "kubeplorer",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Menu:             AppMenu,
		Bind: []interface{}{
			app,
			ollamaProxy,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
