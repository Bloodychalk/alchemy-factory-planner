from desktop.main import main
import os
import sys
if __name__ == "__main__":
    # Windowed executables do not always have standard streams (notably Windows).
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")
    main()
