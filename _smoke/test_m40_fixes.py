import zipfile, xml.etree.ElementTree as ET
import sys
import os

# We will import from fix_audiveris_mxl.py but we can also just run the whole thing or copy the relevant logic.
# Let's inspect the files after different stages.
# Wait, let's write a script that runs the entire fix_score_xml but prints a log when measure 40 is modified by a specific function.

# Let's read scripts/fix_audiveris_mxl.py and instrument it, or write a copy where we add print statement.
# But we can also look at the functions themselves.
# Let's view the implementation of:
# 1) _repair_quarter_chord_before_rest
# 2) _repair_two_quarter_voice_as_eighths
# 3) _repair_three_eighths_as_triplet
# 4) _repair_quarter_pair_before_eighths
# 5) _repair_quarter_pair_after_beam_run

def check_m40_after_each_step():
    pass
