"""A doubly linked list that models a lecture playlist.

Why a linked list? A playlist is a sequence where the main operations are
"what comes before/after this item?" and "move this item somewhere else".
In a doubly linked list, next/previous are O(1) pointer reads and moving an item
is just re-linking it. Items are kept in the order they were added (append at
the tail), exactly like a queue, but can also be reordered.

The list stores only ids, so it has no database or Flask dependency.
"""
from __future__ import annotations

from typing import Hashable, Iterable, Iterator, List, Optional


class _Node:
    __slots__ = ("value", "prev", "next")

    def __init__(self, value: Hashable):
        self.value, self.prev, self.next = value, None, None


class Playlist:
    def __init__(self, items: Iterable[Hashable] = ()):
        self.head: Optional[_Node] = None
        self.tail: Optional[_Node] = None
        self._nodes = {}
        for item in items:
            self.append(item)

    def __len__(self) -> int:
        return len(self._nodes)

    def __contains__(self, item) -> bool:
        return item in self._nodes

    def __iter__(self) -> Iterator[Hashable]:
        node = self.head
        while node:
            yield node.value
            node = node.next

    def ids(self) -> List[Hashable]:
        return list(self)

    def _node(self, item) -> _Node:
        try:
            return self._nodes[item]
        except KeyError:
            raise ValueError(f"{item!r} is not in the playlist") from None

    def append(self, item: Hashable) -> None:
        """Add to the end (queue behaviour: first added plays first)."""
        if item in self._nodes:
            raise ValueError(f"{item!r} is already in the playlist")
        node = _Node(item)
        self._nodes[item] = node
        if self.tail is None:
            self.head = self.tail = node
        else:
            node.prev, self.tail.next, self.tail = self.tail, node, node

    def _unlink(self, node: _Node) -> None:
        if node.prev:
            node.prev.next = node.next
        else:
            self.head = node.next
        if node.next:
            node.next.prev = node.prev
        else:
            self.tail = node.prev
        node.prev = node.next = None

    def remove(self, item: Hashable) -> None:
        self._unlink(self._node(item))
        del self._nodes[item]

    def index_of(self, item: Hashable) -> int:
        node, i = self.head, 0
        target = self._node(item)
        while node is not target:
            node, i = node.next, i + 1
        return i

    def move_to(self, item: Hashable, index: int) -> None:
        """Move `item` so it ends up at 0-based position `index`."""
        if not 0 <= index < len(self):
            raise ValueError("index out of range")
        node = self._node(item)
        self._unlink(node)
        if index == len(self) - 1:                  # becomes the new tail
            if self.tail is None:
                self.head = self.tail = node
            else:
                node.prev, self.tail.next, self.tail = self.tail, node, node
            return
        target = self.head
        for _ in range(index):
            target = target.next
        node.prev, node.next = target.prev, target
        if target.prev:
            target.prev.next = node
        else:
            self.head = node
        target.prev = node

    def move_up(self, item: Hashable) -> None:
        i = self.index_of(item)
        if i > 0:
            self.move_to(item, i - 1)

    def move_down(self, item: Hashable) -> None:
        i = self.index_of(item)
        if i < len(self) - 1:
            self.move_to(item, i + 1)

    def next_of(self, item: Hashable) -> Optional[Hashable]:
        node = self._node(item).next
        return node.value if node else None

    def prev_of(self, item: Hashable) -> Optional[Hashable]:
        node = self._node(item).prev
        return node.value if node else None
