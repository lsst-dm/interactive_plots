REMOTE := slacd:/sdf/home/f/fred3m/u/data/dp2/metrics/edp2
LOCAL  := public/data/metrics

# Where `make deploy` installs the built app. The default assumes dp2_lsst_io
# is checked out alongside interactive_plots in the same ticket workspace;
# override for any other layout:
#
#     make deploy DEST=/path/to/dp2_lsst_io/_static/dp2_data_quality
#
DEST ?= ../../dp2_lsst_io/_static/dp2_data_quality

.PHONY: data build deploy

data:
	mkdir -p $(LOCAL)
	rsync -avz --delete $(REMOTE)/ $(LOCAL)/

build:
	npm run build

# Install the built app into dp2_lsst_io, where it is committed as a static
# artifact and never rebuilt. Run `make data` first: vite copies public/ into
# dist/, so the metrics ship with the bundle and resolve as same-origin.
#
# index.html and vite.svg are dropped because Sphinx supplies the page; only
# the JS, CSS, and data are consumed. PROVENANCE records the commit the
# artifact was built from, since the built files carry no other trace of it.
# A "-dirty" suffix means the build included uncommitted changes and the
# commit alone will not reproduce it; deploy from a clean tree to publish.
deploy: build
	rm -rf $(DEST)
	mkdir -p $(DEST)
	cp -R dist/. $(DEST)/
	rm -f $(DEST)/index.html $(DEST)/vite.svg
	@printf '%s%s\n' \
	  "$$(git rev-parse HEAD)" \
	  "$$(test -n "$$(git status --porcelain)" && echo '-dirty')" \
	  > $(DEST)/PROVENANCE
	@echo "Deployed to $(DEST) from $$(cat $(DEST)/PROVENANCE)"
	@echo ""
	@echo "NOTE: rebuild the docs with a clean, e.g. 'make clean html'."
	@echo "Sphinx returns early when no .rst has changed ('no targets are out"
	@echo "of date') and never reaches the step that copies _static, so an"
	@echo "incremental build reports success while serving the previous bundle."
