#!/usr/bin/env python3
"""Build the restored cloud edition. The prior player remains build-legacy.py."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[1]/'lucky-cloud/build-cloud.py'),run_name='__main__')
