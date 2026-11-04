"""Command-line entry point for source-to-website verification."""
import sys
from check_site import validate

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    validate()
