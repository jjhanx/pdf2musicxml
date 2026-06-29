"""Peek into .omr zip: list entries; optionally dump a sheet snippet."""
import sys
import zipfile

z = zipfile.ZipFile(sys.argv[1])
for n in z.namelist():
    print(n, z.getinfo(n).file_size)
if len(sys.argv) > 2:
    data = z.read(sys.argv[2]).decode("utf-8", "replace")
    print(data[: int(sys.argv[3]) if len(sys.argv) > 3 else 3000])
