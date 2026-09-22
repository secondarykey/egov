package egov

import (
	"errors"
	"net/http"
	"strconv"
	"sync"

	"egov/internal/animwebp"
)

// AnimStore は開いているアニメーション WebP の合成済みフレームを保持し、
// ローカルファイルサーバ経由でフロントエンドへ1枚ずつ渡す。
// バインディングで []byte を返すと JSON(base64) になり毎フレームには重すぎるため、
// フレームの転送だけは HTTP で行う。同時に保持するのは1本だけ。
type AnimStore struct {
	mu   sync.RWMutex
	id   int
	anim *animwebp.Animation
}

func NewAnimStore() *AnimStore { return &AnimStore{} }

// AnimInfo はフロントエンドへ返すアニメーションの概要。
// Animated=false なら静止画として扱う（アニメーションでない WebP など）。
type AnimInfo struct {
	Animated    bool  `json:"animated"`
	ID          int   `json:"id"`
	Width       int   `json:"width"`
	Height      int   `json:"height"`
	DurationsMs []int `json:"durationsMs"`
}

func (s *AnimStore) open(path string) (AnimInfo, error) {
	if !animwebp.IsAnimated(path) {
		s.close()
		return AnimInfo{}, nil
	}
	anim, err := animwebp.Load(path)
	if err != nil {
		s.close()
		if errors.Is(err, animwebp.ErrTooLarge) {
			return AnimInfo{}, errors.New("animation is too large to play")
		}
		return AnimInfo{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.id++
	s.anim = anim
	return AnimInfo{
		Animated:    true,
		ID:          s.id,
		Width:       anim.Width,
		Height:      anim.Height,
		DurationsMs: anim.DurationsMs,
	}, nil
}

func (s *AnimStore) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.anim = nil
}

// ServeFrame は ?id=&i= で指定されたフレームの画素（非乗算 RGBA、行詰め）を返す。
// id が現在のものと違えば 410。別ファイルへ切り替えた後に届いた
// 前のアニメーション向けの要求へ、新しい方のフレームを返さないため。
// 認証（token）は呼び出し側で済ませておくこと。
func (s *AnimStore) ServeFrame(w http.ResponseWriter, r *http.Request) {
	id, err1 := strconv.Atoi(r.URL.Query().Get("id"))
	i, err2 := strconv.Atoi(r.URL.Query().Get("i"))
	if err1 != nil || err2 != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	anim, cur := s.anim, s.id
	s.mu.RUnlock()
	if anim == nil || id != cur {
		http.Error(w, "gone", http.StatusGone)
		return
	}
	if i < 0 || i >= len(anim.Frames) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(anim.Frames[i])
}

// OpenAnimation は path がアニメーション WebP なら全フレームを合成して保持し、
// 再生に必要な情報を返す。アニメーションでなければ Animated=false を返す
// （前に開いていたアニメーションは解放する）。
func (a *API) OpenAnimation(path string) (AnimInfo, error) {
	return a.anims.open(path)
}

// CloseAnimation は保持しているアニメーションのフレームを解放する。
func (a *API) CloseAnimation() {
	a.anims.close()
}
