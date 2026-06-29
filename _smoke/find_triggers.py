import sys
# We can import from scripts/fix_audiveris_mxl.py
sys.path.insert(0, 'scripts')
import fix_audiveris_mxl

def instrument_all():
    orig_before = fix_audiveris_mxl._repair_quarter_pair_before_eighths
    def inst_before(measure, ns, divisions, expected):
        res = orig_before(measure, ns, divisions, expected)
        if res > 0:
            print(f"Triggered _repair_quarter_pair_before_eighths in Measure {measure.get('number')}")
        return res
    fix_audiveris_mxl._repair_quarter_pair_before_eighths = inst_before

    orig_after = fix_audiveris_mxl._repair_quarter_pair_after_beam_run
    def inst_after(measure, ns, divisions, expected):
        res = orig_after(measure, ns, divisions, expected)
        if res > 0:
            print(f"Triggered _repair_quarter_pair_after_beam_run in Measure {measure.get('number')}")
        return res
    fix_audiveris_mxl._repair_quarter_pair_after_beam_run = inst_after

    orig_chord = fix_audiveris_mxl._repair_quarter_chord_before_rest
    def inst_chord(measure, ns, divisions, expected):
        res = orig_chord(measure, ns, divisions, expected)
        if res > 0:
            print(f"Triggered _repair_quarter_chord_before_rest in Measure {measure.get('number')}")
        return res
    fix_audiveris_mxl._repair_quarter_chord_before_rest = inst_chord

instrument_all()
fix_audiveris_mxl.fix_mxl_file('noon.mxl', 'noon_fixed.mxl')
