package attachments

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/txn"
)

// Sweep deletes the files no attachment has that were last written before
// cutoff: those a request that died partway left behind (see the package
// doc), or whose owner was deleted. The cutoff leaves alone an upload
// under way. It returns how many it deleted. The quarterly job runs it
// (cmd/job-quarterly).
func Sweep(ctx context.Context, run *txn.Runner, blobs blobstore.Store, cutoff time.Time) (int, error) {
	attached, err := txn.Read(ctx, run, func(tx *txn.Tx) (map[string]bool, error) {
		all, err := Attachments.All(tx)
		keys := make(map[string]bool, len(all))
		for _, a := range all {
			keys[a.Key] = true
		}
		return keys, err
	})
	if err != nil {
		return 0, err
	}
	files, err := blobs.List(ctx, KeyPrefix)
	if err != nil {
		return 0, err
	}
	var stray []string
	for _, f := range files {
		if !attached[f.Key] && f.Modified.Before(cutoff) {
			stray = append(stray, f.Key)
		}
	}
	if len(stray) == 0 {
		return 0, nil
	}
	return len(stray), blobs.Delete(ctx, stray...)
}
