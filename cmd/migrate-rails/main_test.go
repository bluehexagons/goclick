package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSameDatabaseFileDetectsAliases(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source.sqlite3")
	if err := os.WriteFile(source, []byte("database"), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name string
		link func(string, string) error
	}{
		{
			name: "symlink",
			link: os.Symlink,
		},
		{
			name: "hard link",
			link: os.Link,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			target := filepath.Join(directory, test.name+".sqlite3")
			if err := test.link(source, target); err != nil {
				t.Fatal(err)
			}
			same, err := sameDatabaseFile(source, target)
			if err != nil {
				t.Fatal(err)
			}
			if !same {
				t.Fatal("database alias was not detected")
			}
		})
	}
}

func TestSameDatabaseFileAllowsNewTarget(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source.sqlite3")
	if err := os.WriteFile(source, []byte("database"), 0o600); err != nil {
		t.Fatal(err)
	}

	same, err := sameDatabaseFile(source, filepath.Join(directory, "new.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	if same {
		t.Fatal("new target reported as source database")
	}
}
