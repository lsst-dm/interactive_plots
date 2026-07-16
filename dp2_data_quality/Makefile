REMOTE := slacd:/sdf/home/f/fred3m/u/data/dp2/metrics
LOCAL  := public/data/metrics

.PHONY: data

data:
	mkdir -p $(LOCAL)
	rsync -avz --delete $(REMOTE)/ $(LOCAL)/
