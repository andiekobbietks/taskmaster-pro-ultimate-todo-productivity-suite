"""
Validate a WACZ with warcio, which is not the code that wrote it.

If warcio can read the archive, the WARC is well-formed enough for
pywb, wabac and the rest of the webrecorder tooling. It is an
independent check on the capture, rather than the writer agreeing with
itself.

Usage:
    python scripts/validate-wacz.py <path.wacz>
"""
import gzip
import io
import json
import sys
import zipfile

try:
    from warcio.archiveiterator import ArchiveIterator
except ImportError:
    print("ERROR: warcio not installed. Run: pip install warcio")
    sys.exit(1)


def validate(path: str) -> int:
    problems = []

    with zipfile.ZipFile(path) as z:
        names = z.namelist()

        # The spec's required entries.
        for required in ("archive/data.warc.gz", "pages/pages.jsonl",
                         "datapackage.json"):
            if required not in names:
                problems.append("missing " + required)

        bad = z.testzip()
        if bad is not None:
            problems.append("corrupt zip entry: " + str(bad))

        package = json.loads(z.read("datapackage.json"))
        if package.get("profile") != "wacz":
            problems.append("datapackage profile is %r, not 'wacz'"
                            % package.get("profile"))

        pages = [json.loads(l) for l in
                 z.read("pages/pages.jsonl").decode().splitlines() if l.strip()]
        if not pages:
            problems.append("pages/pages.jsonl is empty")

        warc_bytes = gzip.decompress(z.read("archive/data.warc.gz"))
        records = list(ArchiveIterator(io.BytesIO(warc_bytes)))
        if not records:
            problems.append("the WARC holds no records")

        responses = [r for r in records if r.rec_type == "response"]
        if not responses:
            problems.append("the WARC holds no response records")

        print("%s" % path)
        print("  %d page(s), %d record(s), %d response(s)"
              % (len(pages), len(records), len(responses)))
        for r in responses[:6]:
            uri = r.rec_headers.get_header("WARC-Target-URI") or ""
            ctype = r.http_headers.get_header("Content-Type") if r.http_headers else ""
            print("    %-6s %-28s %s" % (
                r.http_headers.get_statuscode() if r.http_headers else "-",
                (ctype or "")[:28], uri[:76]))

    if problems:
        print()
        for p in problems:
            print("  PROBLEM: %s" % p)
        return 1

    print()
    print("  The archive is a valid WACZ: warcio reads every record.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python scripts/validate-wacz.py <path.wacz>")
        sys.exit(2)
    sys.exit(validate(sys.argv[1]))
