import pathlib
p = pathlib.Path('scripts/run_homr.py')
content = p.read_text('utf-8')
old_patch = """    # Monkey-patch homr to prevent cv2.resize crash (inv_scale_x > 0)
    try:
        import homr.staff_parsing
        orig_get_tr_omr_canvas_size = homr.staff_parsing.get_tr_omr_canvas_size
        def patched_get_tr_omr_canvas_size(*args, **kwargs):
            arr = orig_get_tr_omr_canvas_size(*args, **kwargs)
            if arr[0] < 1:
                arr[0] = 1
            if arr[1] < 1:
                arr[1] = 1
            return arr
        homr.staff_parsing.get_tr_omr_canvas_size = patched_get_tr_omr_canvas_size
    except ImportError:
        pass"""
new_patch = """    # Monkey-patch cv2.resize globally for homr to prevent zero-dimension crashes (inv_scale_x > 0)
    try:
        import cv2
        orig_resize = cv2.resize
        def safe_resize(src, dsize, *args, **kwargs):
            if dsize[0] < 1 or dsize[1] < 1:
                dsize = (max(1, int(dsize[0])), max(1, int(dsize[1])))
            return orig_resize(src, dsize, *args, **kwargs)
        
        import homr.main
        import homr.staff_parsing
        import homr.staff_dewarping
        homr.main.cv2.resize = safe_resize
        homr.staff_parsing.cv2.resize = safe_resize
        homr.staff_dewarping.cv2.resize = safe_resize
    except Exception:
        pass"""
content = content.replace(old_patch, new_patch)
p.write_text(content, 'utf-8')
