# Draws convergence.svg, the paper's figure: trapezoidal and Romberg errors for its four integrands.
# Run in this folder, with matplotlib installed: python convergence.py convergence.svg
import math, sys
import matplotlib
matplotlib.use("svg")
import matplotlib.pyplot as plt

out = sys.argv[1]
# The exact integrals, correctly rounded: e - 1, pi/4, 2/3 and I_0(1).
cases = [
    (r"$f_1 = e^x$", lambda x: math.exp(x), 1.7182818284590453, "#2a78d6", "o", "-"),
    (r"$f_2 = 1/(1+x^2)$", lambda x: 1 / (1 + x * x), math.pi / 4, "#eb6834", "s", "-"),
    (r"$f_3 = \sqrt{x}$", lambda x: math.sqrt(x), 2 / 3, "#1baf7a", "^", "-"),
    (r"$f_4 = e^{\cos 2\pi x}$", lambda x: math.exp(math.cos(2 * math.pi * x)), 1.2660658777520084, "#eda100", "D", "-"),
]
KMAX = 12
def tableau(f):
    R = [[(f(0.) + f(1.)) / 2]]
    for k in range(1, KMAX + 1):
        h = 1 / 2**k
        row = [R[k-1][0] / 2 + h * sum(f((2*i - 1) * h) for i in range(1, 2**(k-1) + 1))]
        for j in range(1, k + 1):
            row.append(row[j-1] + (row[j-1] - R[k-1][j-1]) / (4**j - 1))
        R.append(row)
    return R

FLOOR = 1e-16
plt.rcParams.update({
    "font.family": "serif", "font.serif": ["cmr10"], "mathtext.fontset": "cm",
    "axes.formatter.use_mathtext": True, "font.size": 9,
    "axes.edgecolor": "#52514e", "axes.linewidth": 0.6,
    "xtick.color": "#52514e", "ytick.color": "#52514e",
    "xtick.major.width": 0.6, "ytick.major.width": 0.6,
    "svg.fonttype": "path", "svg.hashsalt": "gutterpress",
})
fig, axes = plt.subplots(1, 2, figsize=(6.5, 2.7), sharey=True)
evals = [2**k + 1 for k in range(KMAX + 1)]
for name, f, I, color, marker, ls in cases:
    R = tableau(f)
    trap = [max(abs(R[k][0] - I), FLOOR) for k in range(KMAX + 1)]
    diag = [max(abs(R[k][k] - I), FLOOR) for k in range(KMAX + 1)]
    for ax, ys in ((axes[0], trap), (axes[1], diag)):
        ax.loglog(evals, ys, ls, color=color, lw=1.2, marker=marker, ms=3.6,
                  mec="white", mew=0.5, label=name)
for ax, title in zip(axes, [r"(a) trapezoidal rule $T(h_k)$", r"(b) Romberg diagonal $R_{k,k}$"]):
    ax.axhline(2.2e-16, color="#8a8984", lw=0.6, ls=":", zorder=0)
    ax.set_title(title, fontsize=9.5, loc="left")
    ax.set_xlabel(r"function evaluations $2^k + 1$")
    ax.set_xlim(1.6, 6000); ax.set_ylim(3e-17, 3)
    ax.set_xticks([2, 10, 100, 1000])
    ax.set_yticks([1e0, 1e-4, 1e-8, 1e-12, 1e-16])
    ax.grid(True, which="major", color="#e4e3df", lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(which="minor", length=0)
axes[0].set_ylabel(r"absolute error $|Q - I|$")
axes[0].text(5000, 2.2e-16 * 2.2, "rounding level", ha="right", va="bottom", fontsize=7.5, color="#52514e")
# reference slopes in panel (a)
xs = [65, 4097]
axes[0].loglog(xs, [3e-2 * (x / 65) ** -2 for x in xs], color="#52514e", lw=0.7, ls="--")
axes[0].text(400, 3e-2 * (400 / 65) ** -2 * 4, r"$\propto h^2$", fontsize=8.5, color="#52514e")
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="upper center", ncol=4, frameon=False, fontsize=8.5,
           bbox_to_anchor=(0.5, 1.02), handlelength=2.2, columnspacing=1.6)
fig.tight_layout(rect=(0, 0, 1, 0.92), w_pad=1.5)
fig.savefig(out, metadata={"Date": None, "Creator": None}, bbox_inches="tight", pad_inches=0.02)
