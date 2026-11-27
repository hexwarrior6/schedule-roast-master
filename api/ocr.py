"""Preview-only OCR lab. Raw binary image POST, bounded input; GET runs synthetic smoke test."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

class handler(BaseHTTPRequestHandler):
    def respond(self,status,obj):
        data=json.dumps(obj,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def allowed(self):
        if os.getenv("VERCEL_ENV")=="production":
            self.respond(404,{"error":"OCR experiment is preview only"});return False
        expected=os.getenv("ANALYSIS_ACCESS_CODE","")
        if expected and not hmac.compare_digest(self.headers.get("x-analysis-code","").encode(),expected.encode()):
            self.respond(401,{"error":"Access code required"});return False
        return True
    def do_GET(self):
        if not self.allowed():return
        try:
            if parse_qs(urlparse(self.path).query).get("topology")==["1"]:
                from ocr_lab.topology import smoke
            else:
                from ocr_lab.engine import smoke
            self.respond(200,smoke())
        except Exception as exc:
            print("OCR smoke failure:",type(exc).__name__)
            self.respond(500,{"error":"OCR initialization or smoke test failed","type":type(exc).__name__})
    def do_POST(self):
        if not self.allowed():return
        try:
            n=int(self.headers.get("Content-Length","0"))
        except ValueError:n=0
        if not 0<n<=3*1024*1024:
            self.respond(413,{"error":"Upload PNG, JPEG or WebP up to 3 MB"});return
        try:
            from ocr_lab.engine import decode,recognize,refine_regions
            try:image=decode(self.rfile.read(n))
            except (ValueError,OSError):
                self.respond(400,{"error":"Invalid or oversized image"});return
            params=parse_qs(urlparse(self.path).query)
            if "regions" in params:
                try:
                    regions=json.loads(params["regions"][0])
                    self.respond(200,refine_regions(image,regions))
                except (ValueError,TypeError,KeyError):
                    self.respond(400,{"error":"Invalid crop regions"})
                return
            report=recognize(image)
            if params.get("layout")==["1"]:
                try:
                    from ocr_lab.layout import build_layout
                    report["layout"]=build_layout(image,report)
                except Exception as exc:
                    if params.get("resilient")!=["1"]:raise
                    print("Layout stage failure:",type(exc).__name__)
                    report["layoutError"]="Layout stage failed: "+type(exc).__name__
            if params.get("topology")==["1"]:
                from ocr_lab.topology import both
                report["topology"]=both(image,report,report.get("layout"))
            if params.get("topology")==["geometry"]:
                try:
                    from ocr_lab.topology import local_topology
                    geometry=local_topology(image,report,report.get("layout"))
                    report["topology"]={"geometry":geometry,"learned":{"status":"unresolved","source":"not requested","cells":[],"ticks":[],"elapsedMs":0}}
                except Exception as exc:
                    print("Geometry stage failure:",type(exc).__name__)
                    report["layoutError"]="Geometry stage failed: "+type(exc).__name__
            self.respond(200,report)
        except Exception as exc:
            print("OCR inference failure:",type(exc).__name__)
            self.respond(500,{"error":"OCR inference failed","type":type(exc).__name__})
