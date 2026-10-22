package migrate

import (
	"bytes"
	"encoding/json"
)

// Fields are an item's fields as stored, numbers kept exact (json.Number).
type Fields = map[string]any

// EachItem is a migration's Up that changes every item of a partition in
// place: change gets an item's fields and says whether it changed them,
// and those it changed are written back. It must change nothing in an
// item it already changed (see Run). Most migrations are one:
//
//	Up: migrate.EachItem("CLIENT", func(id string, f migrate.Fields) (bool, error) {
//		if _, done := f["displayName"]; done {
//			return false, nil
//		}
//		f["displayName"] = f["name"]
//		delete(f, "name")
//		return true, nil
//	}),
func EachItem(pk string, change func(id string, f Fields) (bool, error)) func(*Tx) error {
	return func(m *Tx) error {
		return m.Each(pk, func(id string, data []byte) error {
			dec := json.NewDecoder(bytes.NewReader(data))
			dec.UseNumber()
			var f Fields
			if err := dec.Decode(&f); err != nil {
				return err
			}
			changed, err := change(id, f)
			if err != nil || !changed {
				return err
			}
			out, err := json.Marshal(f)
			if err != nil {
				return err
			}
			return m.Put(pk, id, out)
		})
	}
}
