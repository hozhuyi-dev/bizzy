package statemodel

import "iter"

// Axis is one independent dimension of an entity's State: a name, every
// value it can take, and how to set it on a State. Declare one with NewAxis.
type Axis[S any] struct {
	Name   string
	Values []string
	set    func(s *S, i int)
}

// NewAxis declares an axis over an enum type. Values must list every value,
// so that enumerating the axes covers every state.
func NewAxis[S any, V ~string](name string, values []V, set func(s *S, v V)) Axis[S] {
	labels := make([]string, len(values))
	for i, v := range values {
		labels[i] = string(v)
	}
	return Axis[S]{Name: name, Values: labels, set: func(s *S, i int) { set(s, values[i]) }}
}

// Axes are an entity's axes, in the order the decision table shows them.
type Axes[S any] []Axis[S]

// Size is how many states the axes span.
func (as Axes[S]) Size() int {
	n := 1
	for _, a := range as {
		n *= len(a.Values)
	}
	return n
}

// All yields every combination of the axes: the state, and the index of
// each axis's value in it.
func (as Axes[S]) All() iter.Seq2[S, []int] {
	return func(yield func(S, []int) bool) {
		idx := make([]int, len(as))
		for {
			var s S
			for i, a := range as {
				a.set(&s, idx[i])
			}
			if !yield(s, append([]int(nil), idx...)) {
				return
			}
			// Advance like an odometer, last axis fastest.
			i := len(as) - 1
			for ; i >= 0; i-- {
				idx[i]++
				if idx[i] < len(as[i].Values) {
					break
				}
				idx[i] = 0
			}
			if i < 0 {
				return
			}
		}
	}
}
