from .runtime import ReferenceCache

cache = ReferenceCache()
cache.prepare()
print(cache.root)
