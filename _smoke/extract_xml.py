import re
import sys
import zipfile

z = zipfile.ZipFile(sys.argv[1])
c = z.read("META-INF/container.xml").decode("utf-8")
p = re.search(r'full-path="([^"]+)"', c).group(1)
open(sys.argv[2], "wb").write(z.read(p))
print(p, "->", sys.argv[2])
