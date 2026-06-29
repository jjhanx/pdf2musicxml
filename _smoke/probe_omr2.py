"""Survey sheet#N.xml inter tags/attrs in the .omr."""
import collections
import re
import sys
import zipfile

z = zipfile.ZipFile(sys.argv[1])
data = z.read(sys.argv[2]).decode("utf-8", "replace")
# show all distinct element names
tags = collections.Counter(re.findall(r"<([a-zA-Z][\w-]*)[ >/]", data))
print(dict(tags.most_common(40)))
# sample head inter
m = re.search(r"<head\b[^>]*>", data)
if m:
    print("HEAD:", m.group(0))
for name in ("beam", "flag", "tuplet", "slur", "rest", "stem"):
    m = re.search(rf"<{name}\b[^>]*>", data)
    if m:
        print(name.upper(), ":", m.group(0)[:300])
