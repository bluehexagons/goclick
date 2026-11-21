package webapp

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"
)

type frontendAsset struct {
	content     []byte
	contentType string
	etag        string
}

func loadPublicAssets(static fs.FS) (map[string]frontendAsset, error) {
	// Keep an explicit allowlist. Adding a file to the embedded directory
	// does not make it public, and admin.html has a separate protected route.
	assets := make(map[string]frontendAsset)
	for _, name := range []string{
		"index.html", "app.js", "app.css", "admin.js", "admin.css", "favicon.svg",
		"icons.svg", "achievement-icons.svg", "language-flags.svg",
		"button-material.svg", "button-glow.svg", "background-grain.svg",
	} {
		content, err := fs.ReadFile(static, name)
		if err != nil {
			return nil, fmt.Errorf("read embedded asset %s: %w", name, err)
		}
		assets[name] = frontendAsset{
			content:     content,
			contentType: mime.TypeByExtension(path.Ext(name)),
			etag:        fmt.Sprintf(`"%x"`, sha256.Sum256(content)),
		}
	}
	return assets, nil
}

func (a *App) frontend(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "." || name == "" {
		name = "index.html"
	}
	asset, ok := a.publicAssets[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	// Stable URLs must revalidate on each navigation. Content tags let the
	// browser reuse unchanged files across visits and deployments.
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("ETag", asset.etag)
	if asset.contentType != "" {
		w.Header().Set("Content-Type", asset.contentType)
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(asset.content))
}
